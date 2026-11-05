// WhatsApp Cloud API (API oficial da Meta).
// Adaptado de apps/chat/src/providers/whatsapp-cloud.js (Balbino Chat v0.15.0), que ficou no código mas
// sem uso depois da remoção da API oficial. Mudanças: token lido de variável de ambiente (nunca do banco),
// validação de assinatura do webhook e extração de mensagens recebidas.
import crypto from 'node:crypto';

const VERSAO_GRAPH = 'v23.0';

function token(conexao) {
  const t = conexao.token_env ? process.env[conexao.token_env] : '';
  if (!t) throw new Error(`Token da conexão não configurado (variável ${conexao.token_env || '—'})`);
  return t;
}

async function chamar(conexao, corpo) {
  const r = await fetch(`https://graph.facebook.com/${VERSAO_GRAPH}/${encodeURIComponent(conexao.phone_number_id)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(conexao)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...corpo }),
  });
  let d = {};
  try { d = await r.json(); } catch { /* corpo vazio */ }
  if (!r.ok) throw new Error(d?.error?.message || `Meta Graph HTTP ${r.status}`);
  return d?.messages?.[0]?.id || null;
}

export function enviarTexto(conexao, para, texto) {
  return chamar(conexao, { to: para, type: 'text', text: { preview_url: false, body: String(texto) } });
}

// Primeiro contato (fora da janela de 24h) exige modelo aprovado pela Meta.
export function enviarModelo(conexao, para, variaveis = []) {
  if (!conexao.modelo_primeiro_contato) throw new Error('Conexão sem modelo de primeiro contato aprovado');
  const components = variaveis.length ? [{ type: 'body', parameters: variaveis.map(v => ({ type: 'text', text: String(v) })) }] : [];
  return chamar(conexao, { to: para, type: 'template', template: { name: conexao.modelo_primeiro_contato, language: { code: conexao.idioma_modelo || 'pt_BR' }, components } });
}

export function assinaturaValida(corpoBruto, cabecalho, segredo) {
  if (!segredo || !cabecalho || !String(cabecalho).startsWith('sha256=')) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex');
  const recebido = String(cabecalho).slice(7);
  if (recebido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(recebido, 'hex'));
}

// Extrai mensagens de texto do payload do webhook. Outros tipos viram um marcador legível.
export function extrairMensagens(payload) {
  const saida = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      const phoneNumberId = v?.metadata?.phone_number_id;
      for (const m of v.messages || []) {
        const texto = m.type === 'text' ? m.text?.body
          : m.type === 'button' ? m.button?.text
            : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)
              : `[${m.type || 'mensagem'} recebida — conteúdo não suportado no piloto]`;
        saida.push({ phoneNumberId, telefone: m.from, texto: String(texto || ''), idExterno: m.id, em: Number(m.timestamp) * 1000 || Date.now() });
      }
    }
  }
  return saida;
}
