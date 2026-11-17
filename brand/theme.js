/* Uma preferência de aparência para todos os módulos da Rede Balbino. */
(() => {
  'use strict';
  const key = 'redebalbino:theme', root = document.documentElement;
  const normalize = value => ['light', 'claro'].includes(value) ? 'light' : ['dark', 'escuro'].includes(value) ? 'dark' : null;
  const read = name => { try { return localStorage.getItem(name); } catch { return null; } };
  let theme = normalize(read(key));
  if (!theme) {
    for (const name of ['balbino-portal-theme-v1', 'balbino-theme', 'balbino:tema', 'balbino-informa-tema-v1', 'mat:tema']) {
      const value = read(name); let decoded = value; try { decoded = JSON.parse(value); } catch {}
      theme = normalize(decoded); if (theme) break;
    }
  }
  theme ||= window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  function labels() {
    const dark = theme === 'dark';
    document.querySelectorAll('[data-rb-theme]').forEach(select => { select.value = theme; });
    document.querySelectorAll('#themeToggle, #theme-toggle, #b-tema').forEach(button => {
      const label = dark ? 'Tema claro' : 'Tema escuro';
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute('aria-label', `Ativar ${label.toLowerCase()}`);
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  function set(value) {
    theme = normalize(value) || theme;
    root.dataset.theme = theme; root.dataset.tema = theme === 'light' ? 'claro' : 'escuro';
    try {
      localStorage.setItem(key, theme);
      for (const name of ['balbino-portal-theme-v1', 'balbino-informa-tema-v1', 'balbino-chat-theme']) localStorage.setItem(name, theme);
      for (const name of ['balbino-theme', 'balbino:tema']) localStorage.setItem(name, root.dataset.tema);
      localStorage.setItem('mat:tema', JSON.stringify(root.dataset.tema));
      let appearance = {}; try { appearance = JSON.parse(read('balbino-chat-appearance')) || {}; } catch {}
      localStorage.setItem('balbino-chat-appearance', JSON.stringify({ ...appearance, theme }));
    } catch {}
    labels();
    window.dispatchEvent(new CustomEvent('balbino:theme', { detail: { theme } }));
  }
  window.BalbinoTheme = { set, get: () => theme };
  root.dataset.rbModule = location.pathname.split('/')[1] || 'portal';
  set(theme);
  window.addEventListener('storage', event => { if (event.key === key && normalize(event.newValue) && event.newValue !== theme) set(event.newValue); });
  document.addEventListener('change', event => { if (event.target.matches('[data-rb-theme]')) set(event.target.value); });
  document.addEventListener('DOMContentLoaded', () => {
    if (/^\/conecta(?:\/|$)/.test(location.pathname)) {
      root.classList.add('rb-shell-page');
      const bar = document.createElement('div'); bar.className = 'rb-system-bar';
      bar.innerHTML = '<a class="rb-home" href="/" aria-label="Rede Balbino — portal"><img class="rb-approved-logo" src="/brand/rede-balbino-capelo-2026.png" width="125" height="38" alt="Rede Balbino"></a><nav aria-label="Navegação entre sistemas"><a href="/">Portal</a><details class="rb-systems"><summary>Meus sistemas</summary><div class="rb-system-links"><a href="/conecta/">Balbino Conecta</a><a href="/">Ver meus acessos no portal</a></div></details></nav><label class="rb-theme-label">Aparência <select data-rb-theme aria-label="Escolher tema"><option value="light">Tema claro</option><option value="dark">Tema escuro</option></select></label>';
      document.body.prepend(bar);
      const menu = bar.querySelector('details');
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
      document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
      fetch('/api/portal/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(data => {
        if (!data?.user || data.user.mustChangePassword || !(data.user.apps || []).includes('matriculas')) return;
        const links = bar.querySelector('.rb-system-links');
        for (const [href, title] of [['/matriculas/', 'Matrículas e Metas'], ['/oportunidades/', 'Balbino Oportunidades']]) {
          const link = document.createElement('a'); link.href = href; link.textContent = title; links.append(link);
        }
      }).catch(() => {});
    }
    if (root.dataset.rbModule === 'artes' && !document.querySelector('[data-rb-theme]')) {
      const parent = document.querySelector('.barra nav');
      if (parent) {
        const label = document.createElement('label'); label.className = 'rb-theme-label';
        label.innerHTML = 'Aparência <select data-rb-theme aria-label="Escolher tema"><option value="light">Tema claro</option><option value="dark">Tema escuro</option></select>';
        parent.append(label);
      }
    }
    set(theme);
    new MutationObserver(labels).observe(document.body, { childList: true, subtree: true });
  });
})();
