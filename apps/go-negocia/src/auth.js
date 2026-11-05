import crypto from 'node:crypto';
import { um, executar, novoId, auditar, varios } from './db.js';
import { config } from './config.js';

export function hashSenha(senha, salt) {
  return crypto.scryptSync(String(senha), String(salt), 64).toString('hex');
}

export function criarUsuario({ nome, login, senha, admin = false }) {
  if (!senha || String(senha).length < 10) throw Object.assign(new Error('A senha precisa ter pelo menos 10 caracteres'), { status: 400 });
  const loginLimpo = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(loginLimpo)) throw Object.assign(new Error('Login inválido (3 a 40 caracteres: letras, números, ponto, hífen)'), { status: 400 });
  if (um('SELECT id FROM usuarios WHERE login=?', loginLimpo)) throw Object.assign(new Error('Login já existe'), { status: 409 });
  const id = novoId('usr');
  const salt = crypto.randomBytes(16).toString('hex');
  executar('INSERT INTO usuarios(id, nome, login, senha_salt, senha_hash, admin, ativo, criado_em) VALUES(?,?,?,?,?,?,1,?)',
    id, String(nome || loginLimpo).trim(), loginLimpo, salt, hashSenha(senha, salt), admin ? 1 : 0, Date.now());
  return id;
}

// Cria o primeiro administrador somente se o banco estiver vazio e a senha estiver configurada.
// (Diferente da base atual, não existe login com senha vazia.)
export function garantirAdminInicial() {
  const c = config();
  if (um('SELECT id FROM usuarios LIMIT 1')) return null;
  if (!c.adminSenha || c.adminSenha.length < 10) {
    console.warn('[go-negocia] Nenhum usuário cadastrado. Defina GO_NEGOCIA_ADMIN_SENHA (mín. 10 caracteres) para criar o administrador inicial.');
    return null;
  }
  const id = criarUsuario({ nome: 'Administrador GO Negocia', login: c.adminLogin, senha: c.adminSenha, admin: true });
  auditar({ usuarioId: id, acao: 'ADMIN_INICIAL_CRIADO' });
  return id;
}

function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

export function login(loginInformado, senha) {
  const u = um('SELECT * FROM usuarios WHERE login=? AND ativo=1', String(loginInformado || '').trim().toLowerCase());
  const salt = u?.senha_salt || 'x'.repeat(32);
  const calc = Buffer.from(hashSenha(String(senha || ''), salt), 'hex');
  const ok = u && senha && crypto.timingSafeEqual(calc, Buffer.from(u.senha_hash, 'hex'));
  if (!ok) {
    auditar({ usuarioId: u?.id || null, acao: 'LOGIN_FALHOU', detalhes: { login: String(loginInformado || '').slice(0, 40) } });
    return null;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const agora = Date.now();
  executar('INSERT INTO sessoes(token_hash, usuario_id, criada_em, expira_em) VALUES(?,?,?,?)', tokenHash(token), u.id, agora, agora + config().sessaoHoras * 3600_000);
  executar('DELETE FROM sessoes WHERE expira_em < ?', agora);
  auditar({ usuarioId: u.id, acao: 'LOGIN' });
  return { token, usuarioId: u.id };
}

export function logout(token) {
  if (token) executar('DELETE FROM sessoes WHERE token_hash=?', tokenHash(token));
}

export function usuarioDaSessao(token) {
  if (!token) return null;
  const s = um('SELECT s.usuario_id, s.expira_em FROM sessoes s WHERE s.token_hash=?', tokenHash(token));
  if (!s || s.expira_em < Date.now()) return null;
  const u = um('SELECT id, nome, login, admin FROM usuarios WHERE id=? AND ativo=1', s.usuario_id);
  if (!u) return null;
  return { id: u.id, nome: u.nome, login: u.login, admin: u.admin === 1 };
}

export function listarAcessos(usuarioId) {
  return varios(`SELECT a.organizacao_id, a.papel, a.todas_unidades, o.nome
                 FROM acessos a JOIN organizacoes o ON o.id=a.organizacao_id
                 WHERE a.usuario_id=? AND o.ativa=1 ORDER BY o.nome`, usuarioId);
}
