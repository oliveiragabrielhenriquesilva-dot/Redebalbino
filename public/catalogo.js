/* Acessos da Rede Balbino. Ícones vetoriais incorporados; nenhuma senha é compartilhada. */
(function(root) {
  'use strict';
  const entries = [{"key":"conecta","title":"Balbino Conecta","href":"/conecta/","permission":null,"external":false,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"19\" rx=\"2\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/></svg>","disabled":false,"status":"Acesso da equipe"},{"key":"matriculas","title":"Matrículas e Metas","href":"/matriculas/","permission":"matriculas","external":false,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M4 7h16v14H4zM8 3v8M16 3v8M4 12h16M8 16h2M14 16h2\"/></svg>","disabled":false,"status":"Acesso da equipe"},{"key":"oportunidades","title":"Balbino Oportunidades","href":"/oportunidades/","permission":"matriculas","external":false,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21v-3a7 7 0 0 1 14 0v3M17 6h6M20 3v6\"/></svg>","disabled":false,"status":"Acesso da equipe"},{"key":"vitru","title":"Portal Vitru","href":"https://portal-vitru.sydle.com/","external":true,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"m5 6 7 14L19 6M8 6l4 8 4-8\"/></svg>"},{"key":"sydle","title":"Sydle One","href":"http://vitru.sydle.one/","external":true,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M19 5H8a4 4 0 0 0 0 8h8a3 3 0 0 1 0 6H5\"/></svg>"},{"key":"negociacao","title":"Portal de Negociação","href":"https://portal.ead.cesumar.br/#!/access/login","external":true,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"15\" rx=\"3\"/><path d=\"M3 10h18M7 15h4M16 14v3M14.5 15.5h3\"/></svg>"},{"key":"calendario","title":"Calendário Acadêmico","href":"/conecta/#calendario-academico","permission":null,"external":false,"status":"Módulo 54/2026","icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 3v4M17 3v4M3 10h18M7 14h2M15 14h2M7 18h2M15 18h2\"/></svg>"},{"key":"valorizza","title":"Portal Valorizza","href":"https://portalvalorizza.unicesumar.edu.br/logincandidato.aspx","external":true,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7zM8 11l4 5 4-7\"/></svg>"},{"key":"studeo","title":"Studeo","href":"http://studeo.unicesumar.edu.br/","external":true,"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"m2 8 10-5 10 5-10 5zM6 10v6c4 3 8 3 12 0v-6M22 8v9\"/></svg>"}];
  function access(entry, user) {
    if (entry.disabled) return 'disabled';
    if (entry.external) return 'public';
    if (!user) return 'login';
    if (user.mustChangePassword) return 'password';
    if (entry.permission && !(user.apps || []).includes(entry.permission)) return 'forbidden';
    return 'allowed';
  }
  function destination(value, origin) {
    try { const url = new URL(value, origin);
      if (url.origin === origin && /^\/(matriculas|oportunidades|informa|conecta)(?:\/|$)/.test(url.pathname)) return url.pathname + url.search + url.hash;
    } catch (_) {}
    return null;
  }
  function normalizeOrder(order) {
    const keys = entries.map(entry => entry.key);
    return [...new Set([...(Array.isArray(order) ? order : []), ...keys])].filter(key => keys.includes(key));
  }
  const catalog = { entries, access, destination, normalizeOrder };
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.BalbinoCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);

