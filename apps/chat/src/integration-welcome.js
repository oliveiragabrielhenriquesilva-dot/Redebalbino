import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULTS = Object.freeze({
  enabled: false,
  connectionId: 'principal',
  dailyLimit: 25,
  minIntervalSeconds: 60,
  maxIntervalSeconds: 180,
  start: '08:00',
  end: '18:00',
  allowedLanIp: ''
});

const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function localDateKey(date = new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function saoPauloIso(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(x => [x.type, x.value]));
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', timeZoneName: 'shortOffset' }).formatToParts(date).find(x => x.type === 'timeZoneName')?.value || 'GMT-3';
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(offset);
  const sign = m?.[1]?.startsWith('-') ? '-' : '+';
  const hh = String(Math.abs(Number(m?.[1] || 0))).padStart(2, '0');
  const mm = String(m?.[2] || '00').padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

export function maskPhone(value = '') {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}${'*'.repeat(Math.max(2,d.length-9))}-${d.slice(-4)}`;
}

export function validBrazilPhone(value = '') {
  const d = String(value || '');
  return /^55\d{10,11}$/.test(d);
}

function itemSafe(item) {
  return {
    id_externo: String(item?.id_externo || '').trim().slice(0, 128),
    telefone: String(item?.telefone || '').trim(),
    nome: String(item?.nome || '').trim().slice(0, 180),
    mensagem: String(item?.mensagem || '').trim().slice(0, 4000)
  };
}

export class WelcomeIntegration {
  constructor({ filePath, sendText, checkNumber, setTyping, isConnected, getConnection, clock = () => Date.now(), random = Math.random, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onLog = () => {}, autoStart = false } = {}) {
    if (!filePath) throw new Error('filePath obrigatório');
    this.filePath = filePath;
    this.sendText = sendText || (async () => { throw new Error('Envio não configurado') });
    this.checkNumber = checkNumber || (async () => false);
    this.setTyping = setTyping || (async () => {});
    this.isConnected = isConnected || (() => false);
    this.getConnection = getConnection || (() => null);
    this.clock = clock;
    this.random = random;
    this.sleep = sleep;
    this.onLog = onLog;
    this.timer = null;
    this.running = false;
    this.state = { config: { ...DEFAULTS }, tokenHash: null, items: [], consecutiveErrors: 0, paused: false, pauseReason: null, lastErrorAt: null };
    this.load();
    if (autoStart) this.start();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = { ...this.state, ...saved, config: { ...DEFAULTS, ...(saved.config || {}) }, items: Array.isArray(saved.items) ? saved.items : [] };
      // Não arriscamos reenviar uma mensagem que possa ter sido entregue antes de uma queda.
      for (const item of this.state.items) if (item.status === 'enviando') {
        item.status = 'erro'; item.error = 'Processo interrompido durante o envio; o item não será reenviado automaticamente.'; item.updatedAt = this.clock();
      }
      this.persist();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.persist();
    }
  }

  persist() { atomicJson(this.filePath, this.state); }
  start() { if (this.timer) return; this.schedule(1000); }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  schedule(ms = 15000) { this.stop(); this.timer = setTimeout(() => { this.timer = null; this.processNext().catch(e => this.log('ERRO_PROCESSADOR', null, e.message)).finally(() => this.schedule(this.nextDelay())) }, Math.max(250, ms)); this.timer.unref?.(); }

  publicConfig() {
    const { tokenHash, ...s } = this.state;
    return { ...clone(s.config), tokenConfigured: Boolean(tokenHash), paused: Boolean(s.paused), pauseReason: s.pauseReason || null, consecutiveErrors: Number(s.consecutiveErrors || 0) };
  }

  updateConfig(input = {}) {
    const current = this.state.config;
    const next = { ...current };
    if ('enabled' in input) next.enabled = Boolean(input.enabled);
    if ('connectionId' in input) next.connectionId = String(input.connectionId || '').trim().slice(0, 100) || 'principal';
    if ('dailyLimit' in input) { const n = Number(input.dailyLimit); if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('Limite diário deve ficar entre 1 e 500.'); next.dailyLimit = n; }
    if ('minIntervalSeconds' in input || 'maxIntervalSeconds' in input) {
      const min = Number(input.minIntervalSeconds ?? current.minIntervalSeconds), max = Number(input.maxIntervalSeconds ?? current.maxIntervalSeconds);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 60 || max > 3600 || min > max) throw new Error('Intervalo inválido. Use valores entre 60 e 3600 segundos, com o mínimo menor ou igual ao máximo.');
      next.minIntervalSeconds = min; next.maxIntervalSeconds = max;
    }
    for (const key of ['start', 'end']) if (key in input) { if (!validTime(input[key])) throw new Error(`Horário ${key === 'start' ? 'inicial' : 'final'} inválido.`); next[key] = String(input[key]); }
    if (Number(next.start.replace(':','')) >= Number(next.end.replace(':',''))) throw new Error('O fim da janela precisa ser posterior ao início.');
    if ('allowedLanIp' in input) {
      const ip = String(input.allowedLanIp || '').trim();
      if (ip && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw new Error('Informe um endereço IPv4 local válido ou deixe em branco.');
      next.allowedLanIp = ip;
    }
    this.state.config = next;
    this.persist();
    return this.publicConfig();
  }

  generateToken() {
    const token = `bc_${crypto.randomBytes(32).toString('base64url')}`;
    this.state.tokenHash = sha256(token);
    this.persist();
    return token;
  }

  verifyToken(token = '') {
    const expected = Buffer.from(String(this.state.tokenHash || ''), 'hex');
    const actual = Buffer.from(sha256(String(token || '')), 'hex');
    return expected.length === actual.length && expected.length > 0 && crypto.timingSafeEqual(expected, actual);
  }

  connection() {
    const configured = this.getConnection(this.state.config.connectionId);
    return configured || this.getConnection('principal') || null;
  }

  health() {
    const conn = this.connection(), queued = this.state.items.filter(x => x.status === 'fila').length;
    const today = localDateKey(new Date(this.clock()));
    const sentToday = this.state.items.filter(x => x.status === 'enviada' && x.sentAt && localDateKey(new Date(x.sentAt)) === today).length;
    const phone = String(conn?.phone || '').replace(/\D/g, '');
    return { ok: true, conectado: Boolean(this.isConnected(this.state.config.connectionId)), numero: phone ? maskPhone(phone) : null, fila: queued, enviadas_hoje: sentToday, limite_dia: this.state.config.dailyLimit, pausado: Boolean(this.state.paused), motivo_pausa: this.state.pauseReason || null, janela: `${this.state.config.start}-${this.state.config.end} seg-sex` };
  }

  enqueue(input = []) {
    const accepted = [], duplicates = [], refused = [];
    const rows = Array.isArray(input) ? input : [];
    for (const raw of rows.slice(0, 100)) {
      const x = itemSafe(raw);
      if (!x.id_externo) { refused.push({ id_externo: '', motivo: 'id_externo obrigatório' }); continue; }
      if (this.state.items.some(item => item.id_externo === x.id_externo)) { duplicates.push(x.id_externo); continue; }
      if (!validBrazilPhone(x.telefone)) { refused.push({ id_externo: x.id_externo, motivo: 'telefone inválido' }); continue; }
      if (!x.nome || !x.mensagem) { refused.push({ id_externo: x.id_externo, motivo: 'nome e mensagem obrigatórios' }); continue; }
      const now = this.clock();
      this.state.items.push({ id_externo: x.id_externo, telefone: x.telefone, nome: x.nome, mensagem: x.mensagem, status: 'fila', criadaEm: now, updatedAt: now, sentAt: null, error: null });
      accepted.push(x.id_externo);
    }
    if (rows.length > 100) for (const raw of rows.slice(100)) refused.push({ id_externo: String(raw?.id_externo || '').slice(0, 128), motivo: 'limite de 100 itens por chamada' });
    if (accepted.length) this.persist();
    return { aceitos: accepted, duplicados: duplicates, recusados: refused };
  }

  statuses(ids = []) {
    const wanted = new Set(ids.map(x => String(x).trim()).filter(Boolean));
    return this.state.items.filter(x => wanted.has(x.id_externo)).map(x => ({ id_externo: x.id_externo, status: x.status, enviada_em: x.sentAt ? saoPauloIso(new Date(x.sentAt)) : null, erro: x.error || null }));
  }

  cancel(ids = []) {
    const wanted = new Set(ids.map(x => String(x).trim()).filter(Boolean)), canceled = [], notCanceled = [];
    for (const item of this.state.items) if (wanted.has(item.id_externo)) {
      if (item.status === 'fila') { item.status = 'cancelada'; item.updatedAt = this.clock(); canceled.push(item.id_externo); }
      else notCanceled.push(item.id_externo);
    }
    if (canceled.length) this.persist();
    return { cancelados: canceled, nao_cancelados: notCanceled };
  }

  pause(reason = 'Pausado pelo administrador.') { this.state.paused = true; this.state.pauseReason = String(reason).slice(0, 300); this.persist(); }
  resume() { this.state.paused = false; this.state.pauseReason = null; this.state.consecutiveErrors = 0; this.persist(); }

  localWindowOpen(date = new Date(this.clock())) {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date);
    if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day)) return false;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
    const now = Number(parts.hour) * 60 + Number(parts.minute), [sh, sm] = this.state.config.start.split(':').map(Number), [eh, em] = this.state.config.end.split(':').map(Number);
    return now >= sh * 60 + sm && now < eh * 60 + em;
  }

  nextDelay() {
    if (!this.state.config.enabled || this.state.paused || !this.state.items.some(x => x.status === 'fila')) return 15000;
    const min = this.state.config.minIntervalSeconds, max = this.state.config.maxIntervalSeconds;
    return Math.round((min + this.random() * (max - min)) * 1000);
  }

  async processNext() {
    if (this.running || !this.state.config.enabled || this.state.paused || !this.isConnected(this.state.config.connectionId) || !this.localWindowOpen()) return false;
    const today = localDateKey(new Date(this.clock()));
    const sentToday = this.state.items.filter(x => x.status === 'enviada' && x.sentAt && localDateKey(new Date(x.sentAt)) === today).length;
    if (sentToday >= this.state.config.dailyLimit) return false;
    const item = this.state.items.find(x => x.status === 'fila');
    if (!item) return false;
    this.running = true;
    item.status = 'enviando'; item.updatedAt = this.clock(); this.persist();
    const instanceId = this.state.config.connectionId;
    try {
      const hasWhatsApp = await this.checkNumber(instanceId, item.telefone);
      if (!hasWhatsApp) throw Object.assign(new Error('Número não tem WhatsApp'), { permanent: true });
      const variants = String(item.mensagem).replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_, group) => {
        const choices = group.split('|').map(s => s.trim()).filter(Boolean);
        return choices.length ? choices[Math.floor(this.random() * choices.length)] : '';
      });
      await this.setTyping(instanceId, item.telefone, true);
      await this.sleep(3000 + Math.floor(this.random() * 2001));
      await this.sendText(instanceId, item.telefone, variants);
      item.status = 'enviada'; item.sentAt = this.clock(); item.error = null; item.updatedAt = this.clock();
      this.state.consecutiveErrors = 0; this.persist();
      this.log('ENVIADA', item, null);
      return true;
    } catch (e) {
      item.status = 'erro'; item.error = String(e?.message || e || 'Erro no envio').slice(0, 500); item.updatedAt = this.clock();
      this.state.consecutiveErrors = Number(this.state.consecutiveErrors || 0) + 1;
      this.state.lastErrorAt = this.clock();
      if (this.state.consecutiveErrors >= 3) { this.state.paused = true; this.state.pauseReason = `Fila pausada após 3 erros seguidos. Último erro: ${item.error}`; }
      this.persist(); this.log('ERRO', item, item.error);
      return false;
    } finally {
      try { await this.setTyping(instanceId, item.telefone, false); } catch {}
      this.running = false;
    }
  }

  log(status, item, error) {
    try { this.onLog({ id_externo: item?.id_externo || null, telefone: maskPhone(item?.telefone || ''), horario: saoPauloIso(new Date(this.clock())), status, erro: error || null }); } catch {}
  }
}

