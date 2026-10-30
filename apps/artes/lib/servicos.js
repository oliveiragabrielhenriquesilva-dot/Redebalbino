// Serviços e rotinas: publicação na Meta, agendador e backup
const fs = require('node:fs');
const path = require('node:path');
const { db, DB_PATH, getConfig } = require('./db');
const { ARTES_DIR, gerarJPG } = require('./render');

// ---------- Meta (Instagram) ----------
function metaPronta(polo) {
  const c = getConfig();
  return Boolean(polo && polo.ig_user_id && polo.ig_token && c.supabase_url && c.supabase_key && c.supabase_bucket);
}

// Chaves novas do Supabase (sb_secret_...) vão só no cabeçalho apikey; as antigas (JWT) também no Authorization
function cabecalhoSupabase(chave) {
  const k = String(chave || '').trim();
  return k.startsWith('eyJ') ? { apikey: k, Authorization: `Bearer ${k}` } : { apikey: k };
}

// A Meta busca a imagem por um link público: sobe a arte para o Supabase Storage antes de publicar
async function hospedarArte(arquivoPng) {
  const c = getConfig();
  const arquivo = await gerarJPG(arquivoPng); // a Meta só aceita JPEG
  const base = c.supabase_url.replace(/\/$/, '');
  const caminho = `${new Date().toISOString().slice(0, 10)}/${arquivo}`;
  const r = await fetch(`${base}/storage/v1/object/${c.supabase_bucket}/${caminho}`, {
    method: 'POST',
    headers: { ...cabecalhoSupabase(c.supabase_key), 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: fs.readFileSync(path.join(ARTES_DIR, arquivo))
  });
  if (!r.ok) throw new Error(`Falha ao hospedar a arte (${r.status}): ${await r.text()}`);
  return `${base}/storage/v1/object/public/${c.supabase_bucket}/${caminho}`;
}

async function graph(caminho, params, metodo = 'POST') {
  const c = getConfig();
  const url = new URL(`https://graph.facebook.com/${c.meta_versao || 'v25.0'}/${caminho}`);
  const opts = { method: metodo };
  if (metodo === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else opts.body = new URLSearchParams(params);
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ? j.error.message : `Meta respondeu ${r.status}`);
  return j;
}

async function publicarNaMeta(pub, polo) {
  const imagem = await hospedarArte(pub.arquivo);
  const params = { image_url: imagem, access_token: polo.ig_token };
  if (pub.formato === 'story') params.media_type = 'STORIES';
  else params.caption = pub.legenda || '';
  const cont = await graph(`${polo.ig_user_id}/media`, params);
  // Aguarda o contêiner ficar pronto (normalmente é imediato para imagens)
  for (let i = 0; i < 10; i++) {
    const st = await graph(cont.id, { fields: 'status_code', access_token: polo.ig_token }, 'GET');
    if (st.status_code === 'FINISHED' || !st.status_code) break;
    if (st.status_code === 'ERROR') throw new Error('A Meta recusou a imagem.');
    await new Promise(r => setTimeout(r, 3000));
  }
  const pubMeta = await graph(`${polo.ig_user_id}/media_publish`, { creation_id: cont.id, access_token: polo.ig_token });
  let link = '';
  try { link = (await graph(pubMeta.id, { fields: 'permalink', access_token: polo.ig_token }, 'GET')).permalink || ''; } catch {}
  return link;
}

// Testa as duas pontas antes da primeira publicação: a conta do Instagram (token) e o Supabase (link público)
async function testarMeta(polo) {
  const c = getConfig(); const r = { instagram: '', supabase: '', ok: false };
  if (!polo.ig_user_id || !polo.ig_token) r.instagram = 'Falta o ID da conta ou o token.';
  else {
    try { const j = await graph(polo.ig_user_id, { fields: 'username', access_token: polo.ig_token }, 'GET'); r.instagram = `OK: conectado a @${j.username}`; }
    catch (e) { r.instagram = 'Erro: ' + e.message; }
  }
  if (!c.supabase_url || !c.supabase_key || !c.supabase_bucket) r.supabase = 'Falta configurar o Supabase em Configurações.';
  else {
    try {
      const base = c.supabase_url.replace(/\/$/, '');
      const up = await fetch(`${base}/storage/v1/object/${c.supabase_bucket}/teste-conexao.txt`, {
        method: 'POST', headers: { ...cabecalhoSupabase(c.supabase_key), 'Content-Type': 'text/plain', 'x-upsert': 'true' }, body: 'ok' });
      if (!up.ok) throw new Error(`envio recusado (${up.status}): ${(await up.text()).slice(0, 160)}`);
      const pub = await fetch(`${base}/storage/v1/object/public/${c.supabase_bucket}/teste-conexao.txt`);
      if (!pub.ok) throw new Error('o bucket não está público (marque "Public bucket" no Supabase)');
      r.supabase = 'OK: artes ficam com link público';
    } catch (e) { r.supabase = 'Erro: ' + e.message; }
  }
  r.ok = r.instagram.startsWith('OK') && r.supabase.startsWith('OK');
  return r;
}

// ---------- Agendador ----------
function agoraLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let rodando = false;
async function verificarAgendadas() {
  if (rodando) return;
  rodando = true;
  try {
    const devidas = db.prepare(`SELECT * FROM publicacoes WHERE status = 'aprovada' AND data_hora != '' AND data_hora <= ? AND arquivo != '' AND tutora_id IS NULL`).all(agoraLocal());
    for (const pub of devidas) {
      const polo = db.prepare('SELECT * FROM polos WHERE id = ?').get(pub.polo_id);
      if (!metaPronta(polo)) continue; // sem Meta: fica aguardando postagem manual
      try {
        const link = await publicarNaMeta(pub, polo);
        db.prepare(`UPDATE publicacoes SET status = 'publicada', link = ?, erro = '', publicado_em = datetime('now','localtime') WHERE id = ?`).run(link, pub.id);
      } catch (e) {
        db.prepare(`UPDATE publicacoes SET status = 'erro', erro = ? WHERE id = ?`).run(String(e.message || e), pub.id);
      }
    }
  } finally { rodando = false; }
}

// ---------- Backup ----------
function fazerBackup() {
  const { backup_pasta } = getConfig();
  if (!backup_pasta) return null;
  fs.mkdirSync(backup_pasta, { recursive: true });
  const destino = path.join(backup_pasta, `sistema-${new Date().toISOString().slice(0, 10)}.db`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  fs.copyFileSync(DB_PATH, destino);
  // mantém os 14 backups mais recentes
  const antigos = fs.readdirSync(backup_pasta).filter(f => /^sistema-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(14);
  for (const f of antigos) fs.rmSync(path.join(backup_pasta, f), { force: true });
  return destino;
}

function iniciarRotinas(rodarAutomacoes) {
  setInterval(() => verificarAgendadas().catch(() => {}), 60 * 1000);
  if (rodarAutomacoes) {
    const auto = () => rodarAutomacoes().catch(e => console.error('Automação falhou:', e.message));
    setTimeout(auto, 3000);
    setInterval(auto, 60 * 60 * 1000);
  }
  setTimeout(() => verificarAgendadas().catch(() => {}), 5000);
  const backup = () => { try { fazerBackup(); } catch (e) { console.error('Backup falhou:', e.message); } };
  backup();
  setInterval(backup, 6 * 60 * 60 * 1000);
}

module.exports = { metaPronta, publicarNaMeta, testarMeta, verificarAgendadas, fazerBackup, iniciarRotinas, agoraLocal };
