// Automatizador de Publicações — Polos UniCesumar (sistema local)
// Inicie com: npm start  (ou dois cliques em "Iniciar.bat")
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { exec } = require('node:child_process');
const os = require('node:os');
function loadLocalEnv(){try{for(const line of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i>0&&process.env[t.slice(0,i).trim()]==null)process.env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,'')}}catch{}}
loadLocalEnv();
const { db, getConfig, setConfig, tipoRow } = require('./lib/db');
const render = require('./lib/render');
const sv = require('./lib/servicos');
const automacao = require('./lib/automacao');
const { ICONES, AREAS, iconeSVG, sugerirIcone } = require('./lib/icones');

const PORTA = Number(process.env.PORT || getConfig().porta) || 3210;
const VERSAO = require('./package.json').version;
const BASE = `http://127.0.0.1:${PORTA}/`;
const PUBLIC = path.join(__dirname, 'public');
const ASSETS = path.join(__dirname, 'assets');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---------- utilidades ----------
function enviar(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
}
function arquivoEstatico(res, raiz, rel, download) {
  const alvo = path.normalize(path.join(raiz, rel));
  if (!alvo.startsWith(raiz) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) return enviar(res, 404, { erro: 'Não encontrado' });
  const headers = { 'Content-Type': MIME[path.extname(alvo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`;
  res.writeHead(200, headers);
  fs.createReadStream(alvo).pipe(res);
}
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = []; let tam = 0;
    req.on('data', c => { tam += c.length; if (tam > 30 * 1024 * 1024) { reject(new Error('Arquivo grande demais (máx. 30 MB).')); req.destroy(); } else partes.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(partes).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Dados inválidos.')); } });
    req.on('error', reject);
  });
}
const getTipo = id => tipoRow(db.prepare('SELECT * FROM tipos WHERE id = ?').get(id));
const getPolo = id => db.prepare('SELECT * FROM polos WHERE id = ?').get(id);
const getTutora = id => (id ? db.prepare('SELECT * FROM tutoras WHERE id = ?').get(id) : null);
function poloPublico(p) { if (!p) return p; const { ig_token, ...resto } = p; return { ...resto, tem_token: Boolean(ig_token) }; }
function pubCompleta(p) {
  const polo = getPolo(p.polo_id); const tipo = getTipo(p.tipo);
  const tutora = getTutora(p.tutora_id);
  return { ...p, dados: JSON.parse(p.dados || '{}'), polo_nome: polo ? polo.nome : '?', tipo_nome: tipo ? tipo.nome : p.tipo,
    tutora_nome: tutora ? tutora.nome : '', meta_pronta: !p.tutora_id && sv.metaPronta(polo) };
}
function nomeArquivo(pub, polo) {
  const limpo = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const tutora = getTutora(pub.tutora_id);
  return `${pub.id}-${limpo(pub.tipo)}-${limpo(polo.nome)}${tutora ? '-' + limpo(tutora.nome) : ''}-${pub.formato}`;
}
async function gerarArte(pubId) {
  const pub = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(pubId);
  const tipo = getTipo(pub.tipo); const polo = getPolo(pub.polo_id);
  const arquivo = await render.gerarPNG({ tipo, polo, formato: pub.formato, dados: JSON.parse(pub.dados), base: BASE, nome: nomeArquivo(pub, polo), tutora: getTutora(pub.tutora_id), quando: pub.data_hora });
  db.prepare(`UPDATE publicacoes SET arquivo = ?, erro = '' WHERE id = ?`).run(arquivo, pubId);
  return arquivo;
}
async function chatInternal(pathname,options={}){
  const token=String(process.env.BALBINO_CHAT_TOKEN||'').trim();if(!token)throw new Error('Informe BALBINO_CHAT_TOKEN no arquivo .env do Automatizador de Artes.');
  const base=String(process.env.BALBINO_CHAT_URL||'http://127.0.0.1:3001').replace(/\/$/,''),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const r=await fetch(`${base}${pathname}`,{...options,headers:{...(options.headers||{}),'X-Token':token},signal:controller.signal}),data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Balbino Chat respondeu HTTP ${r.status}.`);return data}finally{clearTimeout(timer)}
}
let whatsappSchedulerBusy=false;
async function publicarWhatsAppAgendadas(){
  if(whatsappSchedulerBusy)return;const config=getConfig(),channelId=String(config.whatsapp_channel_id||'').trim();
  if(config.whatsapp_auto_publicar!=='1'||!channelId||!process.env.BALBINO_CHAT_TOKEN)return;
  whatsappSchedulerBusy=true;
  try{
    const catalog=(await chatInternal('/api/integracao/canais-whatsapp')).channels||[];if(!catalog.length)return;
    const now=sv.agoraLocal(),rows=db.prepare("SELECT * FROM publicacoes WHERE status IN ('aprovada','publicada') AND data_hora<>'' AND data_hora<=? AND tutora_id IS NULL AND whatsapp_agendada_em IS NOT NULL AND COALESCE(whatsapp_channel_status,'')='' ORDER BY data_hora,id LIMIT 5").all(now);
    for(const pub of rows){
      const targetChannel=String(pub.whatsapp_channel_id||channelId).trim();
      const channel=catalog.find(x=>String(x.id)===targetChannel);if(!channel||!channel.connected||(channel.role&&!['OWNER','ADMIN','ADMINISTRATOR'].includes(String(channel.role).toUpperCase())))continue;
      db.prepare("UPDATE publicacoes SET whatsapp_channel_id=?,whatsapp_channel_status='ENVIANDO',whatsapp_channel_error=NULL WHERE id=? AND COALESCE(whatsapp_channel_status,'')=''").run(targetChannel,pub.id);
      try{
        if(!pub.arquivo)await gerarArte(pub.id);const current=db.prepare('SELECT * FROM publicacoes WHERE id=?').get(pub.id),file=path.resolve(render.ARTES_DIR,path.basename(String(current.arquivo||'')));
        if(!file.startsWith(path.resolve(render.ARTES_DIR)+path.sep)||!fs.existsSync(file))throw new Error('A imagem da publicação não foi encontrada. Gere a arte novamente.');
        const bytes=fs.readFileSync(file);if(bytes.length>20*1024*1024)throw new Error('A arte excede o limite de 20 MB.');
        const ext=path.extname(file).toLowerCase(),result=await chatInternal('/api/integracao/canais-whatsapp/publicar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:targetChannel,caption:String(current.legenda||''),fileName:path.basename(file),mimeType:ext==='.jpg'||ext==='.jpeg'?'image/jpeg':ext==='.webp'?'image/webp':'image/png',mediaBase64:bytes.toString('base64')})});
        db.prepare("UPDATE publicacoes SET whatsapp_channel_id=?,whatsapp_channel_name=?,whatsapp_channel_message_id=?,whatsapp_channel_published_at=datetime('now','localtime'),whatsapp_channel_status='ENVIADA',whatsapp_channel_error=NULL WHERE id=?").run(result.channelId,result.channelName,result.messageId||null,pub.id);
      }catch(e){db.prepare("UPDATE publicacoes SET whatsapp_channel_status='ERRO',whatsapp_channel_error=? WHERE id=?").run(String(e.message||e).slice(0,500),pub.id)}
    }
  }finally{whatsappSchedulerBusy=false}
}

const rotas = [];
const rota = (metodo, padrao, fn) => rotas.push({ metodo, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// ---------- Acesso pela rede (outros computadores, com senha) ----------
const ehLocal = req => process.env.HOSTED !== '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const baseDe = req => (req.headers.host && /^[\w.\-:\[\]]+$/.test(req.headers.host) ? `http://${req.headers.host}/` : BASE);
const sessoes = new Map(); // token -> validade (ms)
const tentativasLogin = new Map(); // ip -> { n, ate }
const DIAS30 = 30 * 24 * 3600 * 1000;
function hashSenha(senha, sal = crypto.randomBytes(16).toString('hex')) { return sal + ':' + crypto.scryptSync(String(senha), sal, 32).toString('hex'); }
function senhaConfere(senha, guardado) {
  const [sal, h] = String(guardado || '').split(':'); if (!sal || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(senha), sal, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function lerCookie(req, nome) { const m = new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)').exec(req.headers.cookie || ''); return m ? m[1] : ''; }
function autorizado(req) {
  if (process.env.CENTRAL_BALBINO_EMBEDDED === '1') {
    try { const portal = JSON.parse(req.headers['x-balbino-portal'] || 'null'); return Boolean(portal && portal.app === 'artes'); }
    catch { return false; }
  }
  if (ehLocal(req)) return true;
  const t = lerCookie(req, 'ap_sessao'); const val = sessoes.get(t);
  if (val && val > Date.now()) return true;
  if (t) sessoes.delete(t);
  return false;
}
function enderecosRede() {
  try { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORTA}/`); }
  catch (e) { console.warn('Não foi possível listar endereços locais da rede:', e.message); return []; }
}
const PAGINA_LOGIN = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · Automatizador</title><link rel="icon" href="/assets/simbolo-branco.png">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#03132D;font-family:'Segoe UI',Arial,sans-serif;color:#03132D}
form{background:#fff;border-radius:16px;padding:32px 28px;width:min(360px,92vw);box-shadow:0 20px 50px rgba(0,0,0,.35)}h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px;color:#4A5873;font-size:14px;line-height:1.45}
label{font-size:13px;font-weight:600}input{width:100%;box-sizing:border-box;margin:6px 0 16px;padding:12px;border:1px solid #C9D2E3;border-radius:10px;font-size:16px}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#172C58;color:#fff;font-size:16px;font-weight:700;cursor:pointer}#erro{color:#B42318;font-size:14px;min-height:20px;margin-top:10px}</style></head>
<body><form id="f"><h1>Automatizador de publicações</h1><p>Acesso pela rede. Digite a senha definida no computador principal.</p>
<label for="s">Senha</label><input id="s" type="password" autocomplete="current-password" autofocus required><button>Entrar</button><div id="erro" role="alert"></div></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({senha:document.getElementById('s').value})});
const j=await r.json().catch(()=>({}));if(r.ok)location.href='/';else document.getElementById('erro').textContent=j.erro||'Não foi possível entrar.';};</script></body></html>`;

rota('POST', '/api/login', async (req, _, res) => {
  const ip = req.socket.remoteAddress || '?'; const t = tentativasLogin.get(ip);
  if (t && t.n >= 5 && t.ate > Date.now()) throw new Error('Muitas tentativas. Aguarde um minuto.');
  const { senha } = await lerCorpo(req);
  const senhaHospedada = process.env.HOSTED === '1' ? hashSenha(process.env.ARTES_ADMIN_PASSWORD || '') : '';
  if (!(senhaHospedada ? senhaConfere(senha, senhaHospedada) : senhaConfere(senha, getConfig().rede_senha))) {
    const n = t && t.ate > Date.now() ? t.n + 1 : 1; tentativasLogin.set(ip, { n, ate: Date.now() + 60000 });
    throw new Error('Senha incorreta.');
  }
  tentativasLogin.delete(ip);
  const token = crypto.randomBytes(32).toString('hex'); sessoes.set(token, Date.now() + DIAS30);
  res.setHeader('Set-Cookie', `ap_sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DIAS30 / 1000}`);
  return { ok: true };
});
rota('POST', '/api/sair', (req, _, res) => { sessoes.delete(lerCookie(req, 'ap_sessao')); res.setHeader('Set-Cookie', 'ap_sessao=; Path=/; Max-Age=0'); return { ok: true }; });
rota('GET', '/api/rede', (req) => { const c = getConfig(); return { ativa: c.rede_ativa === '1', tem_senha: Boolean(c.rede_senha), local: ehLocal(req), enderecos: c.rede_ativa === '1' ? enderecosRede() : [], porta: PORTA }; });
rota('PUT', '/api/rede', async (req) => {
  if (!ehLocal(req)) throw new Error('O acesso pela rede só pode ser alterado no computador principal.');
  const b = await lerCorpo(req); const c = getConfig(); const novo = {};
  if (b.senha) { if (String(b.senha).length < 6) throw new Error('Use uma senha com pelo menos 6 caracteres.'); novo.rede_senha = hashSenha(b.senha); sessoes.clear(); }
  const ativa = Boolean(b.ativa);
  if (ativa && !novo.rede_senha && !c.rede_senha) throw new Error('Defina uma senha antes de liberar o acesso pela rede.');
  novo.rede_ativa = ativa ? '1' : '0';
  setConfig(novo);
  if ((c.rede_ativa === '1') !== ativa) setTimeout(reabrirEscuta, 300); // passa a ouvir (ou deixa de ouvir) a rede
  if (!ativa) sessoes.clear();
  return { ok: true, enderecos: ativa ? enderecosRede() : [] };
});

// ---------- rotas da API ----------

rota('GET', '/api/estado', () => {
  const c = getConfig();
  return { versao: VERSAO, navegador: render.acharNavegador(), supabase: Boolean(c.supabase_url && c.supabase_key), agora: sv.agoraLocal() };
});

// Polos
rota('GET', '/api/polos', () => db.prepare('SELECT * FROM polos ORDER BY ativo DESC, nome').all().map(poloPublico));
rota('POST', '/api/polos', async (req) => {
  const b = await lerCorpo(req);
  if (!b.nome) throw new Error('Informe o nome do polo.');
  const r = db.prepare(`INSERT INTO polos (nome, endereco, whatsapp_vendas, whatsapp_pedagogico, horario, instagram, ig_user_id, ig_token, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(b.nome, b.endereco || '', b.whatsapp_vendas || '', b.whatsapp_pedagogico || '', b.horario || '', b.instagram || '', b.ig_user_id || '', b.ig_token || '', b.ativo === false ? 0 : 1);
  return poloPublico(getPolo(r.lastInsertRowid));
});
rota('PUT', '/api/polos/:id', async (req, { id }) => {
  const b = await lerCorpo(req); const atual = getPolo(id);
  if (!atual) throw new Error('Polo não encontrado.');
  const n = { ...atual, ...b };
  if (!b.ig_token) n.ig_token = atual.ig_token; // token só muda se for informado
  if (b.remover_token) n.ig_token = '';
  db.prepare(`UPDATE polos SET nome=?, endereco=?, whatsapp_vendas=?, whatsapp_pedagogico=?, horario=?, instagram=?, ig_user_id=?, ig_token=?, ativo=? WHERE id=?`)
    .run(n.nome, n.endereco, n.whatsapp_vendas, n.whatsapp_pedagogico, n.horario, n.instagram, n.ig_user_id, n.ig_token, n.ativo ? 1 : 0, id);
  return poloPublico(getPolo(id));
});

// Tipos de publicação
rota('GET', '/api/tipos', () => db.prepare('SELECT * FROM tipos ORDER BY ordem, nome').all().map(tipoRow)
  .map(t => ({ ...t, formatos_disponiveis: t.formatos.filter(f => render.templateExiste(t.id, f)), templates_faltando: t.formatos.filter(f => !render.templateExiste(t.id, f)).map(f => `${t.id}-${f}.html`) })));
rota('PUT', '/api/tipos/:id', async (req, { id }) => {
  const b = await lerCorpo(req); const t = getTipo(id);
  if (!t) throw new Error('Tipo não encontrado.');
  const campos = Array.isArray(b.campos) ? t.campos.map(c => { const novo = b.campos.find(x => x.chave === c.chave) || {}; return { ...c, rotulo: novo.rotulo ?? c.rotulo, padrao: novo.padrao ?? c.padrao }; }) : t.campos;
  const grupo = ['comercial', 'pedagogico'].includes(b.grupo) ? b.grupo : (t.grupo || 'comercial');
  db.prepare('UPDATE tipos SET nome=?, descricao=?, contato=?, legenda_padrao=?, campos=?, ativo=?, icone=?, data_completa=?, grupo=? WHERE id=?')
    .run(b.nome ?? t.nome, b.descricao ?? t.descricao, b.contato ?? t.contato, b.legenda_padrao ?? t.legenda_padrao, JSON.stringify(campos), b.ativo === undefined ? t.ativo : (b.ativo ? 1 : 0), b.icone ?? t.icone ?? 'capelo', b.data_completa === undefined ? (t.data_completa || 0) : (b.data_completa ? 1 : 0), grupo, id);
  return tipoRow(db.prepare('SELECT * FROM tipos WHERE id = ?').get(id));
});

// Prévia e legenda
rota('POST', '/api/previa', async (req) => {
  const b = await lerCorpo(req);
  const tipo = getTipo(b.tipo); const polo = getPolo(b.polo_id);
  if (!tipo || !polo) throw new Error('Escolha o tipo e o polo.');
  const html = render.htmlArte({ tipo, polo, formato: b.formato, dados: b.dados || {}, base: baseDe(req), tutora: getTutora(b.tutora_id), quando: b.data_hora || '' });
  return { html, ...render.TAMANHOS[b.formato] };
});
rota('POST', '/api/legenda', async (req) => {
  const b = await lerCorpo(req);
  const tipo = getTipo(b.tipo); const polo = getPolo(b.polo_id);
  if (!tipo || !polo) throw new Error('Escolha o tipo e o polo.');
  if (typeof b.modelo === 'string') tipo.legenda_padrao = b.modelo;
  return { legenda: render.legenda(tipo, polo, b.dados || {}, getTutora(b.tutora_id), b.data_hora || '') };
});

// Publicações
rota('GET', '/api/publicacoes', (req) => {
  const u = new URL(req.url, BASE); const st = u.searchParams.get('status'); const lote = u.searchParams.get('lote');
  const linhas = lote ? db.prepare('SELECT * FROM publicacoes WHERE lote = ? ORDER BY id').all(lote)
    : u.searchParams.get('tutoras') ? db.prepare('SELECT * FROM publicacoes WHERE tutora_id IS NOT NULL ORDER BY id DESC LIMIT 500').all()
    : st ? db.prepare('SELECT * FROM publicacoes WHERE status = ? ORDER BY data_hora DESC, id DESC').all(st)
    : db.prepare('SELECT * FROM publicacoes ORDER BY CASE status WHEN \'rascunho\' THEN 0 WHEN \'aprovada\' THEN 1 WHEN \'erro\' THEN 2 ELSE 3 END, data_hora ASC, id DESC LIMIT 500').all();
  return linhas.map(pubCompleta);
});
rota('POST', '/api/publicacoes', async (req) => {
  const b = await lerCorpo(req);
  const tipo = getTipo(b.tipo);
  if (!tipo) throw new Error('Escolha o tipo de publicação.');
  const porTutora = b.destino === 'tutoras';
  const tutoras = porTutora ? (b.tutoras || []).map(getTutora).filter(Boolean) : [];
  const polos = (b.polos || []).map(getPolo).filter(Boolean);
  const formatos = (b.formatos || []).filter(f => tipo.formatos.includes(f) && render.templateExiste(tipo.id, f));
  if (porTutora && !tutoras.length) throw new Error('Escolha pelo menos uma tutora.');
  if (!porTutora && !polos.length) throw new Error('Escolha pelo menos um polo.');
  if (!formatos.length) throw new Error('Escolha pelo menos um formato.');
  const lote = crypto.randomBytes(4).toString('hex');
  const modelo = typeof b.modelo_legenda === 'string' ? b.modelo_legenda : tipo.legenda_padrao;
  const ids = [];
  const ins = db.prepare(`INSERT INTO publicacoes (lote, tipo, polo_id, formato, dados, legenda, data_hora, status, tutora_id, origem) VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?)`);
  // Cada destino é um polo (Instagram do polo) ou uma tutora (arte com o nome, a foto e o WhatsApp dela)
  const destinos = porTutora ? tutoras.map(t => ({ polo: getPolo(t.polo_id), tutora: t })).filter(d => d.polo) : polos.map(p => ({ polo: p, tutora: null }));
  // Uma arte para cada curso: os dados do curso (nome, grau, preço) entram por cima dos textos comuns da campanha
  const cursosLote = (Array.isArray(b.cursos) ? b.cursos : []).map(id => db.prepare('SELECT * FROM cursos WHERE id = ?').get(Number(id))).filter(Boolean);
  if (Array.isArray(b.cursos) && b.cursos.length && !cursosLote.length) throw new Error('Os cursos escolhidos não foram encontrados.');
  const { dadosDoCurso } = require('./lib/cursos');
  const variacoes = cursosLote.length ? cursosLote.map(c => ({ ...(b.dados || {}), ...dadosDoCurso(c, tipo.id) })) : [b.dados || {}];
  for (const dados of variacoes) {
    for (const { polo, tutora } of destinos) {
      const leg = render.legenda({ ...tipo, legenda_padrao: modelo }, polo, dados, tutora, b.data_hora || '');
      for (const f of formatos) ids.push(Number(ins.run(lote, tipo.id, polo.id, f, JSON.stringify(dados), leg, b.data_hora || '', tutora ? tutora.id : null, tutora ? 'tutora' : 'manual').lastInsertRowid));
    }
  }
  const erros = [];
  for (const id of ids) {
    try { await gerarArte(id); } catch (e) { erros.push(e.message); db.prepare('UPDATE publicacoes SET erro = ? WHERE id = ?').run(e.message, id); }
  }
  return { criadas: ids.length, erros: [...new Set(erros)], lote };
});
rota('PUT', '/api/publicacoes/:id', async (req, { id }) => {
  const b = await lerCorpo(req);
  const p = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id);
  if (!p) throw new Error('Publicação não encontrada.');
  const status = b.status ?? p.status;
  if (!['rascunho', 'aprovada', 'publicada', 'erro'].includes(status)) throw new Error('Status inválido.');
  db.prepare(`UPDATE publicacoes SET legenda = ?, data_hora = ?, status = ?, publicado_em = CASE WHEN ? = 'publicada' AND publicado_em = '' THEN datetime('now','localtime') ELSE publicado_em END WHERE id = ?`)
    .run(b.legenda ?? p.legenda, b.data_hora ?? p.data_hora, status, status, id);
  const cfgWhats=getConfig();if(status==='aprovada'&&String(b.data_hora??p.data_hora??'')&&cfgWhats.whatsapp_auto_publicar==='1'&&cfgWhats.whatsapp_channel_id)db.prepare("UPDATE publicacoes SET whatsapp_channel_id=COALESCE(NULLIF(whatsapp_channel_id,''),?),whatsapp_agendada_em=COALESCE(whatsapp_agendada_em,datetime('now','localtime')) WHERE id=?").run(cfgWhats.whatsapp_channel_id,id);
  // Contagem regressiva (Esquenta Black): mudou o dia da publicação, a arte é refeita com os dias certos
  if (b.data_hora !== undefined && String(b.data_hora).slice(0, 10) !== String(p.data_hora || '').slice(0, 10)
    && getTipo(p.tipo)?.campos.some(c => c.chave === 'contagem')) {
    try { await gerarArte(id); } catch (e) { db.prepare('UPDATE publicacoes SET erro = ? WHERE id = ?').run(e.message, id); }
  }
  return pubCompleta(db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id));
});
rota('POST', '/api/publicacoes/:id/gerar', async (req, { id }) => { await gerarArte(id); return pubCompleta(db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id)); });
rota('POST', '/api/publicacoes/:id/publicar', async (req, { id }) => {
  const p = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id);
  const polo = getPolo(p.polo_id);
  if (p.tutora_id) throw new Error('Artes de tutora não são publicadas no Instagram do polo: baixe e envie para a tutora.');
  if (!sv.metaPronta(polo)) throw new Error('A conexão com o Instagram deste polo ainda não foi configurada.');
  if (!p.arquivo) await gerarArte(id);
  try {
    const link = await sv.publicarNaMeta(db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id), polo);
    db.prepare(`UPDATE publicacoes SET status='publicada', link=?, erro='', publicado_em=datetime('now','localtime') WHERE id=?`).run(link, id);
  } catch (e) { db.prepare(`UPDATE publicacoes SET status='erro', erro=? WHERE id=?`).run(e.message, id); throw e; }
  return pubCompleta(db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id));
});
rota('DELETE', '/api/publicacoes/:id', (req, { id }) => {
  const p = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id);
  if (p && p.arquivo) fs.rmSync(path.join(render.ARTES_DIR, p.arquivo), { force: true });
  // Publicação automática excluída não volta a ser criada
  if (p && p.auto_chave) db.prepare('INSERT OR IGNORE INTO auto_ignoradas (chave) VALUES (?)').run(p.auto_chave);
  db.prepare('DELETE FROM publicacoes WHERE id = ?').run(id);
  return { ok: true };
});

// Cursos (rodízio automático)
rota('GET', '/api/cursos', () => db.prepare('SELECT * FROM cursos ORDER BY ativo DESC, curso').all());
function salvarCurso(b, id) {
  if (!String(b.curso || '').trim()) throw new Error('Informe o nome do curso.');
  const t = k => String(b[k] || '').trim();
  const v = [b.curso.trim(), t('nivel'), t('linha1'), t('linha2'), t('detalhe'), b.icone || '', b.ativo ? 1 : 0,
    t('preco_cheio'), t('preco_desconto'), t('desconto'), t('primeira'), t('link')];
  const cols = 'curso=?, nivel=?, linha1=?, linha2=?, detalhe=?, icone=?, ativo=?, preco_cheio=?, preco_desconto=?, desconto=?, primeira=?, link=?';
  if (id) db.prepare(`UPDATE cursos SET ${cols} WHERE id=?`).run(...v, id);
  else id = db.prepare('INSERT INTO cursos (curso, nivel, linha1, linha2, detalhe, icone, ativo, preco_cheio, preco_desconto, desconto, primeira, link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...v).lastInsertRowid;
  if (b.em_propostas !== undefined) db.prepare('UPDATE cursos SET em_propostas = ? WHERE id = ?').run(b.em_propostas ? 1 : 0, id);
  if (b.campanha !== undefined) db.prepare('UPDATE cursos SET campanha = ? WHERE id = ?').run(t('campanha'), id);
  return db.prepare('SELECT * FROM cursos WHERE id = ?').get(id);
}
rota('GET', '/api/cursos/:id/dados', (req, { id }) => {
  const c = db.prepare('SELECT * FROM cursos WHERE id = ?').get(id);
  if (!c) throw new Error('Curso não encontrado.');
  const tipo = new URL(req.url, 'http://x').searchParams.get('tipo') || 'curso';
  return require('./lib/cursos').dadosDoCurso(c, tipo);
});
rota('POST', '/api/cursos', async (req) => salvarCurso(await lerCorpo(req)));
rota('PUT', '/api/cursos/:id', async (req, { id }) => salvarCurso(await lerCorpo(req), id));
rota('DELETE', '/api/cursos/:id', (req, { id }) => { db.prepare('DELETE FROM cursos WHERE id = ?').run(id); return { ok: true }; });

// ---------- Propostas empresariais ----------
const propostas = require('./lib/propostas');
const txt = v => String(v ?? '').trim();
rota('GET', '/api/segmentos', () => db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM curso_segmento cs WHERE cs.segmento_id = s.id) AS qtd_cursos,
  (SELECT COUNT(*) FROM empresas e WHERE e.segmento_id = s.id) AS qtd_empresas FROM segmentos s ORDER BY s.ativo DESC, s.ordem, s.nome`).all()
  .map(sg => ({ ...sg, cursos: db.prepare('SELECT curso_id, prioridade FROM curso_segmento WHERE segmento_id = ? ORDER BY prioridade').all(sg.id) })));
function salvarSegmento(b, id) {
  if (!txt(b.nome)) throw new Error('Informe o nome do segmento.');
  if (id) db.prepare('UPDATE segmentos SET nome = ?, subtitulo = ?, ativo = ? WHERE id = ?').run(txt(b.nome), txt(b.subtitulo), b.ativo === false ? 0 : 1, id);
  else id = Number(db.prepare('INSERT INTO segmentos (nome, subtitulo, ordem) VALUES (?, ?, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM segmentos))').run(txt(b.nome), txt(b.subtitulo)).lastInsertRowid);
  // Cursos ligados ao segmento, na ordem recebida (a posição vira a prioridade)
  if (Array.isArray(b.cursos)) {
    db.prepare('DELETE FROM curso_segmento WHERE segmento_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO curso_segmento (curso_id, segmento_id, prioridade) VALUES (?, ?, ?)');
    b.cursos.map(Number).filter(Boolean).forEach((cid, i) => ins.run(cid, id, i + 1));
  }
  return db.prepare('SELECT * FROM segmentos WHERE id = ?').get(id);
}
rota('POST', '/api/segmentos', async (req) => salvarSegmento(await lerCorpo(req)));
rota('PUT', '/api/segmentos/:id', async (req, { id }) => salvarSegmento(await lerCorpo(req), Number(id)));

rota('GET', '/api/empresas', () => db.prepare(`SELECT e.*, s.nome AS segmento_nome, p.nome AS polo_nome, t.nome AS tutora_nome FROM empresas e
  LEFT JOIN segmentos s ON s.id = e.segmento_id LEFT JOIN polos p ON p.id = e.polo_id LEFT JOIN tutoras t ON t.id = e.tutora_id
  ORDER BY e.ativo DESC, COALESCE(NULLIF(e.nome_fantasia, ''), e.nome)`).all());
function salvarEmpresa(b, id) {
  if (!txt(b.nome)) throw new Error('Informe o nome da empresa.');
  if (!b.segmento_id) throw new Error('Escolha o segmento.');
  if (!getPolo(b.polo_id)) throw new Error('Escolha o polo responsável.');
  const nomeFant = txt(b.nome_fantasia) || txt(b.nome);
  const dup = db.prepare("SELECT id FROM empresas WHERE lower(COALESCE(NULLIF(nome_fantasia, ''), nome)) = lower(?) AND polo_id = ? AND id != ?").get(nomeFant, Number(b.polo_id), Number(id) || 0);
  if (dup) throw new Error('Já existe uma empresa com esse nome neste polo.');
  const v = [txt(b.nome), txt(b.nome_fantasia), Number(b.segmento_id), txt(b.cidade), Number(b.polo_id), b.tutora_id ? Number(b.tutora_id) : null,
    txt(b.contato_nome), txt(b.contato_whatsapp), txt(b.contato_email), txt(b.observacoes), b.ativo === false ? 0 : 1];
  const cols = 'nome=?, nome_fantasia=?, segmento_id=?, cidade=?, polo_id=?, tutora_id=?, contato_nome=?, contato_whatsapp=?, contato_email=?, observacoes=?, ativo=?';
  if (id) db.prepare(`UPDATE empresas SET ${cols} WHERE id = ?`).run(...v, id);
  else id = Number(db.prepare(`INSERT INTO empresas (nome, nome_fantasia, segmento_id, cidade, polo_id, tutora_id, contato_nome, contato_whatsapp, contato_email, observacoes, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...v).lastInsertRowid);
  return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
}
rota('POST', '/api/empresas', async (req) => salvarEmpresa(await lerCorpo(req)));
rota('PUT', '/api/empresas/:id', async (req, { id }) => salvarEmpresa(await lerCorpo(req), Number(id)));

rota('GET', '/api/propostas/sugestao', (req) => propostas.sugestao(Number(new URL(req.url, BASE).searchParams.get('empresa'))));
rota('POST', '/api/propostas/previa', async (req) => { const m = propostas.montar(await lerCorpo(req), baseDe(req)); return { html: m.html, w: m.w, h: m.h }; });
rota('POST', '/api/propostas/gerar', async (req) => propostas.gerar(await lerCorpo(req), BASE));
rota('POST', '/api/propostas/lote', async (req) => propostas.gerarLote(await lerCorpo(req), BASE));
rota('GET', '/api/propostas/zip', (req, _, res) => {
  const ids = (new URL(req.url, BASE).searchParams.get('empresas') || '').split(',').map(Number).filter(Boolean);
  const arqs = propostas.arquivosDasEmpresas(ids);
  if (!arqs.length) throw new Error('Nenhuma proposta gerada para baixar.');
  const zip = criarZip(arqs.map(a => ({ nome: a, dados: fs.readFileSync(path.join(render.ARTES_DIR, a)) })));
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="propostas-${new Date().toISOString().slice(0, 10)}.zip"` });
  res.end(zip);
  return null;
});

// Tutoras (vendedoras): cada uma com nome, WhatsApp, polo e foto
rota('GET', '/api/tutoras', () => db.prepare('SELECT t.*, p.nome AS polo_nome FROM tutoras t LEFT JOIN polos p ON p.id = t.polo_id ORDER BY t.ativo DESC, p.nome, t.nome').all());
function salvarTutora(b, id) {
  if (!String(b.nome || '').trim()) throw new Error('Informe o nome da tutora.');
  if (!getPolo(b.polo_id)) throw new Error('Escolha o polo da tutora.');
  const v = [b.nome.trim(), String(b.whatsapp || '').trim(), Number(b.polo_id), b.foto || '', b.ativo === false ? 0 : 1];
  if (id) db.prepare('UPDATE tutoras SET nome=?, whatsapp=?, polo_id=?, foto=?, ativo=? WHERE id=?').run(...v, id);
  else id = db.prepare('INSERT INTO tutoras (nome, whatsapp, polo_id, foto, ativo) VALUES (?, ?, ?, ?, ?)').run(...v).lastInsertRowid;
  return getTutora(id);
}
rota('POST', '/api/tutoras', async (req) => salvarTutora(await lerCorpo(req)));
rota('PUT', '/api/tutoras/:id', async (req, { id }) => salvarTutora(await lerCorpo(req), id));
rota('DELETE', '/api/tutoras/:id', (req, { id }) => { db.prepare('UPDATE tutoras SET ativo = 0 WHERE id = ?').run(id); return { ok: true }; });
rota('POST', '/api/fotos', async (req) => {
  const b = await lerCorpo(req);
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(b.base64 || '');
  if (!m) throw new Error('Envie uma foto em JPG, PNG ou WEBP.');
  const nome = `foto-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(render.FOTOS_DIR, nome), Buffer.from(m[2], 'base64'));
  return { foto: nome };
});

// Baixar várias artes num arquivo .zip (sem compressão; as imagens já são comprimidas)
function criarZip(arquivos) {
  const locais = []; const centrais = []; let pos = 0;
  const agora = new Date();
  const dosData = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const dosHora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  for (const { nome, dados } of arquivos) {
    const n = Buffer.from(nome, 'utf8'); const crc = zlib.crc32(dados);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6);
    loc.writeUInt16LE(dosHora, 10); loc.writeUInt16LE(dosData, 12); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(dados.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(dosHora, 12); cen.writeUInt16LE(dosData, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(dados.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(pos, 42);
    locais.push(loc, n, dados); centrais.push(cen, n); pos += 30 + n.length + dados.length;
  }
  const tamCentral = centrais.reduce((t, b) => t + b.length, 0);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}
rota('GET', '/api/zip', (req, _, res) => {
  const ids = (new URL(req.url, BASE).searchParams.get('ids') || '').split(',').map(Number).filter(Boolean);
  const pubs = ids.map(id => db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id)).filter(p => p && p.arquivo && fs.existsSync(path.join(render.ARTES_DIR, p.arquivo)));
  if (!pubs.length) throw new Error('Nenhuma arte para baixar.');
  // Nome legível: tipo-curso-polo(-tutora)-formato.png, sem repetir; mais um legendas.txt com a legenda de cada arte
  const limpo = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const usados = new Set(); const legendas = [];
  const arquivos = pubs.map(p => {
    const tipo = getTipo(p.tipo); const polo = getPolo(p.polo_id); const tutora = getTutora(p.tutora_id);
    let dados = {}; try { dados = JSON.parse(p.dados || '{}'); } catch {}
    const base = [limpo(tipo ? tipo.nome : p.tipo), limpo(dados.curso), limpo(polo && polo.nome), tutora ? limpo(tutora.nome) : '', p.formato].filter(Boolean).join('-');
    let nome = base + '.png'; for (let i = 2; usados.has(nome); i++) nome = `${base}-${i}.png`;
    usados.add(nome);
    legendas.push(`=== ${nome} ===\r\n${String(p.legenda || '').replace(/\r?\n/g, '\r\n')}\r\n`);
    return { nome, dados: fs.readFileSync(path.join(render.ARTES_DIR, p.arquivo)) };
  });
  arquivos.push({ nome: 'legendas.txt', dados: Buffer.from('\ufeff' + legendas.join('\r\n'), 'utf8') });
  const zip = criarZip(arquivos);
  const tipos = [...new Set(pubs.map(p => p.tipo))];
  const prefixo = tipos.length === 1 ? limpo((getTipo(tipos[0]) || {}).nome || tipos[0]) : 'artes';
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${prefixo}-${new Date().toISOString().slice(0, 10)}.zip"` });
  res.end(zip);
  return null;
});

// Encerrar (usado quando uma versão nova é aberta com esta ainda rodando)
rota('POST', '/api/desligar', (req) => {
  if (!ehLocal(req)) throw new Error('Só pode ser usado neste computador.'); setTimeout(() => process.exit(0), 300); return { ok: true, versao: VERSAO }; });

// Automações
rota('GET', '/api/automacao', () => ({ plano: automacao.previa(), vencimentos: automacao.proximosVencimentos(6), arrasto: automacao.proximosVencimentos(6, 'arrasto', 20) }));
rota('POST', '/api/automacao/executar', () => automacao.executar(gerarArte));
rota('GET', '/api/whatsapp/canais', async () => { const d=await chatInternal('/api/integracao/canais-whatsapp'); return d.channels||[]; });

// Fotos
// Ícones disponíveis para as artes
rota('GET', '/api/icones', () => ({ areas: AREAS, icones: Object.fromEntries(Object.entries(ICONES).map(([k, v]) => [k, { nome: v.nome, area: v.area, svg: iconeSVG(k, 'currentColor') }])) }));
rota('GET', '/api/icones/sugerir', (req) => ({ icone: sugerirIcone(new URL(req.url, BASE).searchParams.get('curso') || '') }));

// Configurações
rota('GET', '/api/config', () => { const c = getConfig(); const { pexels_key, rede_senha, ...resto } = c; return { ...resto, supabase_key: c.supabase_key ? '••••••' : '' }; });
rota('PUT', '/api/config', async (req) => {
  const b = await lerCorpo(req); const permitidas = ['porta', 'navegador', 'backup_pasta', 'supabase_url', 'supabase_key', 'supabase_bucket', 'meta_versao',
    'auto_aprovar', 'horizonte_dias', 'feriados_extras', 'boleto_ativo', 'boleto_dia', 'boleto_dias_antes', 'boleto_hora', 'boleto_formatos', 'arrasto_ativo', 'arrasto_dia', 'arrasto_dias_antes', 'arrasto_hora', 'arrasto_formatos',
    'cursos_ativo', 'cursos_dias', 'cursos_hora', 'cursos_formatos', 'cursos_por_dia', 'cursos_modelo',
    'whatsapp_channel_id', 'whatsapp_auto_publicar',
    'proposta_chamada', 'proposta_cargo', 'proposta_titulo', 'proposta_faixa', 'proposta_whats_rotulo', 'proposta_rodape', 'proposta_site'];
  const novo = {};
  for (const k of permitidas) if (b[k] !== undefined && b[k] !== '••••••') novo[k] = String(b[k]).trim();
  setConfig(novo); return { ok: true };
});
rota('POST', '/api/backup', () => { const d = sv.fazerBackup(); if (!d) throw new Error('Escolha uma pasta de backup em Configurações.'); return { arquivo: d }; });
rota('POST', '/api/polos/:id/testar-meta', async (req, { id }) => {
  const polo = db.prepare('SELECT * FROM polos WHERE id = ?').get(id);
  if (!polo) throw new Error('Polo não encontrado.');
  return sv.testarMeta(polo);
});
rota('POST', '/api/teste-navegador', async () => {
  const tipo = getTipo('agendamento'); const polo = db.prepare('SELECT * FROM polos ORDER BY id LIMIT 1').get();
  const arq = await render.gerarPNG({ tipo, polo, formato: 'feed', dados: {}, base: BASE, nome: 'teste-navegador' });
  return { arquivo: arq };
});

// ---------- servidor ----------
const servidor = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, BASE);
    const p = decodeURIComponent(u.pathname);
    if (!autorizado(req) && !(p === '/api/login' && req.method === 'POST') && !p.startsWith('/assets/')) {
      if (p.startsWith('/api/')) return enviar(res, 401, { erro: 'Faça login para continuar.', login: true });
      return enviar(res, 200, PAGINA_LOGIN, 'text/html; charset=utf-8');
    }
    if (p.startsWith('/api/')) {
      for (const r of rotas) {
        const m = r.metodo === req.method && r.re.exec(p);
        if (m) { const out = await r.fn(req, m.groups || {}, res); if (out !== null) enviar(res, 200, out); return; }
      }
      return enviar(res, 404, { erro: 'Rota não encontrada' });
    }
    if (p.startsWith('/assets/')) return arquivoEstatico(res, ASSETS, p.slice(8));
    if (p.startsWith('/fotos/')) return arquivoEstatico(res, render.FOTOS_DIR, p.slice(7));
    if (p.startsWith('/artes/')) return arquivoEstatico(res, render.ARTES_DIR, p.slice(7), u.searchParams.has('baixar') ? path.basename(p) : null);
    return arquivoEstatico(res, PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    enviar(res, 400, { erro: e.message || String(e) });
  }
});

const hostEscuta = () => process.env.HOST || (getConfig().rede_ativa === '1' ? '0.0.0.0' : '127.0.0.1');
function iniciar() { servidor.listen(PORTA, hostEscuta()); }
function reabrirEscuta() {
  if (process.env.CENTRAL_BALBINO_EMBEDDED === '1') return;
  servidor.close(() => servidor.listen(PORTA, hostEscuta(), () => console.log(getConfig().rede_ativa === '1'
    ? `  Acesso pela rede liberado: ${enderecosRede().join('  ')}` : '  Acesso pela rede desligado.')));
  servidor.closeAllConnections();
}
let rotinasHospedadasIniciadas = false;
function iniciarRotinasHospedadas() {
  if (rotinasHospedadasIniciadas) return;
  rotinasHospedadasIniciadas = true;
    console.log('');
    console.log(`  Automatizador de Publicações — Polos UniCesumar (versão ${VERSAO})`);
    console.log(`  Aberto em ${BASE}`);
    console.log('  Deixe esta janela aberta enquanto usar o sistema (ela publica os agendamentos).');
    if (getConfig().rede_ativa === '1') console.log(`  Outros computadores da rede: ${enderecosRede().join('  ')}`);
    const faltando = db.prepare('SELECT * FROM tipos').all().map(tipoRow).flatMap(t => t.formatos.filter(f => !render.templateExiste(t.id, f)).map(f => `${t.id}-${f}.html`));
    if (faltando.length) console.log(`  ATENÇÃO: faltam arquivos na pasta templates: ${faltando.join(', ')}`);
    console.log('');
    sv.iniciarRotinas(() => automacao.executar(gerarArte));
    const whatsappTimer=setInterval(()=>publicarWhatsAppAgendadas().catch(e=>console.error('Publicação no Canal do WhatsApp falhou:',e.message)),30000);whatsappTimer.unref?.();
    setTimeout(()=>publicarWhatsAppAgendadas().catch(()=>{}),8000);
    if (process.argv.includes('--abrir')) {
      const cmd = process.platform === 'win32' ? `start "" "${BASE}"` : process.platform === 'darwin' ? `open "${BASE}"` : `xdg-open "${BASE}"`;
      exec(cmd);
    }
}
servidor.once('listening', iniciarRotinasHospedadas);
let tentativas = 0;
servidor.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Já existe um sistema aberto nesta porta: se for de outra versão, pede para ele fechar e assume o lugar
  let versaoAberta = '';
  try { versaoAberta = (await (await fetch(BASE + 'api/estado')).json()).versao || ''; } catch {}
  if (versaoAberta === VERSAO || tentativas >= 3) {
    if (versaoAberta !== VERSAO) {
      console.log('');
      console.log('  Uma versão antiga do sistema continua aberta em outra janela preta.');
      console.log('  Feche essa outra janela e abra o Iniciar.bat de novo.');
      console.log('');
      return;
    }
    console.log(`O sistema já está aberto em ${BASE}`);
    if (process.argv.includes('--abrir') && process.platform === 'win32') exec(`start "" "${BASE}"`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  tentativas++;
  console.log(`  Encontrei a versão ${versaoAberta || 'antiga'} aberta. Fechando para abrir a ${VERSAO}...`);
  try { await fetch(BASE + 'api/desligar', { method: 'POST' }); } catch {}
  setTimeout(iniciar, 1500);
});
if (require.main === module) iniciar();
module.exports = { servidor, iniciarRotinasHospedadas };
