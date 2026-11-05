// v0.15.0 • FAQ automático — busca da melhor resposta na base de conhecimento.
// Usado pelo bot da triagem e pelo "Sugerir resposta" dos atendentes.

const STOP = new Set(('a o os as um uma uns umas de do da dos das no na nos nas em para pra pro por com sem ' +
  'que qual quais como onde quando quanto quantos quantas e ou se eu voce voces meu minha meus minhas seu sua ' +
  'ele ela isso esse essa este esta aqui ai la ja nao sim tem ter fazer faco faz posso pode preciso quero gostaria ' +
  'saber sobre favor oi ola bom boa dia tarde noite obrigado obrigada tudo bem ate mais').split(' '));

export function normalizarTexto(v = '') {
  return String(v || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(v) { return normalizarTexto(v).split(' ').filter(t => t.length >= 3 && !STOP.has(t)); }
// "contratos" ≈ "contrato", "estagiario" ≈ "estagio": compara pelo radical (5 primeiras letras)
function parecido(a, b) { if (a === b) return true; const n = Math.min(5, a.length, b.length); return n >= 5 && a.slice(0, n) === b.slice(0, n); }

export function palavrasChave(item = {}) {
  const raw = Array.isArray(item.keywords) ? item.keywords.join(',') : String(item.keywords || '');
  return raw.split(/[,;\n]+/).map(normalizarTexto).filter(Boolean);
}

export function pontuarFaq(pergunta, item) {
  const q = normalizarTexto(pergunta), qt = tokens(pergunta);
  if (!q || !qt.length) return 0;
  let score = 0;
  for (const kw of palavrasChave(item)) {
    const kt = kw.split(' ').filter(Boolean);
    if (kt.length > 1) { if ((` ${q} `).includes(` ${kw} `)) score += 4; else if (kt.every(t => qt.some(x => parecido(x, t)))) score += 3; }
    else if (qt.some(x => parecido(x, kw))) score += 3;
  }
  const titulo = [...new Set(tokens(item.title))];
  for (const t of titulo) if (qt.some(x => parecido(x, t))) score += 1;
  return score;
}

// Devolve a melhor resposta (score >= minimo) ou null.
export function buscarFaq(pergunta, base = [], { minimo = 3, departmentId = null } = {}) {
  let melhor = null, melhorScore = 0;
  for (const item of base) {
    if (item?.active === false || item?.autoReply === false || !String(item?.content || '').trim()) continue;
    let s = pontuarFaq(pergunta, item);
    if (departmentId && item.departmentId && item.departmentId === departmentId) s += 0.5; // desempate pelo setor
    if (s > melhorScore) { melhor = item; melhorScore = s; }
  }
  return melhorScore >= minimo ? { item: melhor, score: melhorScore } : null;
}
