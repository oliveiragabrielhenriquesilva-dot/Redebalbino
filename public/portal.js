(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'balbino-portal-theme-v1';
  function setTheme(theme, persist = false) {
    const isDark = theme !== 'light';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const button = $('themeToggle');
    if (button) {
      button.innerHTML = isDark ? '☾ <span>Tema escuro</span>' : '☀ <span>Tema claro</span>';
      button.setAttribute('aria-pressed', String(isDark));
      button.setAttribute('aria-label', `Tema ${isDark ? 'escuro' : 'claro'} ativo. Alternar para tema ${isDark ? 'claro' : 'escuro'}`);
      button.title = `Tema ${isDark ? 'escuro' : 'claro'} ativo · clique para alternar`;
    }
    if (persist) try { localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light'); } catch (_) { /* preferência indisponível */ }
  }
  try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch (_) { setTheme('dark'); }
  $('themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  const catalog = window.BalbinoCatalog;
  const apps = Object.fromEntries(catalog.entries.map(entry => [entry.key, entry]));
  let pendingDestination = catalog.destination(new URL(location.href).searchParams.get('next') || '', location.origin);
  let loginRequested = Boolean(pendingDestination);
  let me = null, users = [], tutorCandidates = [];
  let organizing = false, draggedKey = null;
  function localOrder() { try { return JSON.parse(localStorage.getItem('balbino-home-order:' + (me?.id || 'guest')) || '[]'); } catch { return []; } }
  let homeOrder = catalog.normalizeOrder(localOrder());
  function rememberOrder() { try { localStorage.setItem('balbino-home-order:' + (me?.id || 'guest'), JSON.stringify(homeOrder)); } catch {} }
  function moveCard(key, targetKey, focus = true) {
    const from = homeOrder.indexOf(key), to = homeOrder.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return;
    homeOrder.splice(from, 1); homeOrder.splice(to, 0, key); render();
    $('orderStatus').textContent = `${apps[key].title} movido para a posição ${to + 1}.`;
    if (focus) document.querySelector(`[data-home-key="${key}"] .order-move`)?.focus();
  }
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Falha na solicitação (${response.status})`);
    return data;
  };
  const show = (node, visible) => node.classList.toggle('hidden', !visible);
  function toast(message, error = false) {
    const node = $('toast'); node.textContent = message; node.classList.toggle('error', error); show(node, true);
    clearTimeout(toast.timer); toast.timer = setTimeout(() => show(node, false), 3500);
  }
  function render() {
    const logged = Boolean(me);
    const mustChangePassword = logged && Boolean(me.mustChangePassword);
    const showLogin = !logged && loginRequested && $('setupWarning').dataset.configured !== 'false';
    show($('loginView'), showLogin);
    show($('changePasswordView'), mustChangePassword);
    show($('dashboardView'), !showLogin && !mustChangePassword);
    show($('logoutBtn'), logged);
    show($('openLoginBtn'), !logged);
    show($('manageUsersBtn'), logged && !mustChangePassword && me.isAdmin);
    const grid = $('appGrid'); grid.replaceChildren();
    for (const key of homeOrder) {
      const app = apps[key];
      const state = catalog.access(app, me);
      const card = document.createElement(organizing || state === 'disabled' || state === 'forbidden' ? 'article' : 'a');
      card.className = `home-card home-${app.key}`; card.dataset.homeKey = app.key;
      const icon = document.createElement('span'); icon.className = 'home-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = app.icon;
      const title = document.createElement('h2'); title.textContent = app.title;
      const status = document.createElement('span'); status.className = 'home-status';
      status.textContent = state === 'disabled' ? app.status : state === 'forbidden' ? 'Acesso não liberado' : app.external ? 'Acesso externo ↗' : state === 'allowed' ? 'Acessar sistema →' : 'Entrar para acessar →';
      if (organizing) {
        card.draggable = true; card.classList.add('organizing');
        card.addEventListener('dragstart', event => { draggedKey = app.key; event.dataTransfer.setData('text/plain', app.key); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
        card.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
        card.addEventListener('drop', event => { event.preventDefault(); if (draggedKey) moveCard(draggedKey, app.key, false); draggedKey = null; });
        card.addEventListener('dragend', () => { draggedKey = null; card.classList.remove('dragging'); });
      } else if (state === 'disabled' || state === 'forbidden') { card.classList.add('unavailable'); card.setAttribute('aria-disabled', 'true'); }
      else {
        card.href = app.href;
        if (app.external) { card.target = '_blank'; card.rel = 'noopener noreferrer'; }
        else card.addEventListener('click', event => {
          if (catalog.access(app, me) === 'allowed') return;
          event.preventDefault(); pendingDestination = app.href; loginRequested = true; render();
          if (!me) $('loginUsername').focus();
        });
      }
      card.append(icon, title, status);
      if (organizing) {
        const controls = document.createElement('div'); controls.className = 'order-controls';
        for (const [delta, label] of [[-1, 'Mover antes'], [1, 'Mover depois']]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'order-move';
          button.textContent = delta < 0 ? '←' : '→'; button.setAttribute('aria-label', label + ': ' + app.title);
          const index = homeOrder.indexOf(app.key); button.disabled = index + delta < 0 || index + delta >= homeOrder.length;
          button.addEventListener('click', () => moveCard(app.key, homeOrder[homeOrder.indexOf(app.key) + delta])); controls.append(button);
        }
        card.append(controls);
      }
      grid.append(card);
    }
    show($('emptyState'), false);
    $('organizeBtn').setAttribute('aria-pressed', String(organizing));
    $('organizeBtn').textContent = organizing ? 'Cancelar' : 'Organizar atalhos';
    show($('saveOrderBtn'), organizing); show($('resetOrderBtn'), organizing); show($('orderHint'), organizing);
  }
  function continueToSystem() {
    if (!me || me.mustChangePassword || !pendingDestination) return;
    const target = catalog.destination(pendingDestination, location.origin);
    if (target) location.assign(target);
  }
  $('openLoginBtn').addEventListener('click', () => { loginRequested = true; render(); $('loginUsername').focus(); });
  $('backHomeBtn').addEventListener('click', () => { loginRequested = false; pendingDestination = null; history.replaceState(null, '', '/'); render(); });
  $('organizeBtn').addEventListener('click', async () => {
    if (organizing) { homeOrder = catalog.normalizeOrder(localOrder()); }
    organizing = !organizing; render();
  });
  $('resetOrderBtn').addEventListener('click', () => { homeOrder = catalog.normalizeOrder([]); render(); });
  $('saveOrderBtn').addEventListener('click', async () => {
    const button = $('saveOrderBtn'); button.disabled = true;
    try {
      if (me) { const result = await request('/api/portal/preferences', { method: 'PUT', body: JSON.stringify({ homeOrder }) }); homeOrder = catalog.normalizeOrder(result.homeOrder); }
      rememberOrder(); organizing = false; render(); toast(me ? 'Ordem salva na sua conta.' : 'Ordem salva neste navegador.');
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
  async function loadOrder() {
    homeOrder = catalog.normalizeOrder(localOrder());
    if (me && !me.mustChangePassword) {
      try { const prefs = await request('/api/portal/preferences'); homeOrder = catalog.normalizeOrder(prefs.homeOrder); rememberOrder(); }
      catch { /* A cópia local continua disponível se a rede falhar. */ }
    }
    organizing = false; render();
  }
  async function refresh() {
    const data = await request('/api/portal/me');
    if (data.configured === false) {
      $('setupWarning').dataset.configured = 'false'; show($('setupWarning'), true); me = null; render(); return;
    }
    $('setupWarning').dataset.configured = 'true'; show($('setupWarning'), false); me = data.user; await loadOrder();
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('loginSubmit'), error = $('loginError');
    show(error, false); button.disabled = true;
    try {
      const data = await request('/api/portal/login', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
      me = data.user; $('loginPassword').value = ''; await loadOrder();
      continueToSystem();
    } catch (err) { error.textContent = err.message; show(error, true); }
    finally { button.disabled = false; }
  });
  $('changePasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('changePasswordError'), button = event.submitter;
    show(error, false);
    if ($('newOwnPassword').value !== $('confirmOwnPassword').value) {
      error.textContent = 'A confirmação não corresponde à nova senha.'; show(error, true); return;
    }
    if ($('newOwnPassword').value === $('currentPassword').value) {
      error.textContent = 'A nova senha deve ser diferente da atual.'; show(error, true); return;
    }
    if (button) button.disabled = true;
    try {
      await request('/api/portal/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('currentPassword').value, password: $('newOwnPassword').value }) });
      $('changePasswordForm').reset(); await refresh(); toast('Senha atualizada. As outras sessões foram encerradas.'); continueToSystem();
    } catch (err) { error.textContent = err.message; show(error, true); }
    finally { if (button) button.disabled = false; }
  });
  $('logoutBtn').addEventListener('click', async () => { try { await request('/api/portal/logout', { method: 'POST', body: '{}' }); } catch {} me = null; organizing = false; homeOrder = catalog.normalizeOrder(localOrder()); loginRequested = false; pendingDestination = null; history.replaceState(null, '', '/'); render(); });
  $('manageUsersBtn').addEventListener('click', async () => { $('usersDialog').showModal(); await loadUsers(); });
  $('closeUsersBtn').addEventListener('click', () => $('usersDialog').close());
  $('newUserBtn').addEventListener('click', () => openForm(null));
  $('prepareTutorUsersBtn').addEventListener('click', async () => {
    const panel = $('tutorProvision');
    show(panel, panel.classList.contains('hidden'));
    if (!panel.classList.contains('hidden')) await loadTutorPreview();
  });
  $('cancelTutorProvisionBtn').addEventListener('click', () => {
    $('tutorProvisionForm').reset(); show($('tutorProvision'), false); show($('tutorProvisionError'), false);
  });
  $('cancelUserBtn').addEventListener('click', closeForm);
  $('usersDialog').addEventListener('click', event => { if (event.target === $('usersDialog')) $('usersDialog').close(); });
  function selectedApps() { return [...document.querySelectorAll('input[name="app"]:checked')].map(input => input.value); }
  function toggleMappings() {
    show($('matriculasMapping'), selectedApps().includes('matriculas'));
    show($('chatMapping'), selectedApps().includes('chat'));
  }
  document.querySelectorAll('input[name="app"]').forEach(input => input.addEventListener('change', toggleMappings));
  function openForm(user) {
    $('userForm').reset(); $('editUserId').value = user?.id || '';
    $('userFormTitle').textContent = user ? `Editar ${user.name}` : 'Novo usuário';
    $('newUsername').disabled = Boolean(user); $('newUsername').required = !user;
    $('newPassword').required = !user; show($('passwordField'), !user);
    for (const input of document.querySelectorAll('input[name="app"]')) input.checked = user ? user.apps.includes(input.value) : false;
    $('newName').value = user?.name || ''; $('newUsername').value = user?.username || '';
    $('matriculasLogin').value = user?.accounts?.matriculas || '';
    $('chatUsername').value = user?.accounts?.chat || '';
    show($('userError'), false); show($('userForm'), true); toggleMappings();
    $('userForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closeForm() { show($('userForm'), false); }
  async function loadUsers() {
    try { const data = await request('/api/portal/users'); users = data.users; renderUsers(); }
    catch (err) { toast(err.message, true); }
  }
  async function loadTutorPreview() {
    const preview = $('tutorPreview'); preview.replaceChildren(); show($('tutorProvisionError'), false);
    try {
      const data = await request('/api/portal/tutor-users/preview'); tutorCandidates = data.tutors || [];
      if (!tutorCandidates.length) { preview.textContent = 'Nenhum tutor ativo encontrado.'; return; }
      for (const tutor of tutorCandidates) {
        const row = document.createElement('div'); row.className = 'tutor-preview-row';
        const identity = document.createElement('strong'); identity.textContent = tutor.name;
        const details = document.createElement('span'); details.textContent = tutor.error ? tutor.error : `${tutor.username} · ${tutor.polo}`;
        row.append(identity, details); preview.append(row);
      }
      if (tutorCandidates.some(tutor => tutor.error || !tutor.username)) {
        $('tutorProvisionError').textContent = 'Há vínculo de polo sem definição. Ajuste o cadastro antes de criar os acessos.';
        show($('tutorProvisionError'), true); $('createTutorUsersBtn').disabled = true;
      } else $('createTutorUsersBtn').disabled = false;
    } catch (error) {
      $('tutorProvisionError').textContent = error.message; show($('tutorProvisionError'), true);
    }
  }
  function renderUsers() {
    const list = $('userList'); list.replaceChildren();
    for (const user of users) {
      const row = document.createElement('article'); row.className = 'user-row';
      const info = document.createElement('div'); info.className = 'user-info';
      const name = document.createElement('strong'); name.textContent = user.name;
      const meta = document.createElement('small'); meta.className = 'user-sub'; meta.textContent = `${user.username} · ${user.apps.map(k => apps[k]?.title || k).join(', ') || 'Sem sistemas'}${user.isAdmin ? ' · Administrador' : ''}${user.active ? '' : ' · Desativado'}`;
      info.append(name, meta); const actions = document.createElement('div'); actions.className = 'row-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-btn'; edit.textContent = 'Editar'; edit.addEventListener('click', () => openForm(user));
      const password = document.createElement('button'); password.type = 'button'; password.className = 'secondary-btn'; password.textContent = 'Senha'; password.addEventListener('click', () => resetPassword(user));
      const active = document.createElement('button'); active.type = 'button'; active.className = 'secondary-btn'; active.textContent = user.active ? 'Desativar' : 'Ativar'; active.disabled = user.id === me.id; active.addEventListener('click', () => toggleActive(user));
      actions.append(edit, password, active); row.append(info, actions); list.append(row);
    }
  }
  $('userForm').addEventListener('submit', async event => {
    event.preventDefault(); const id = $('editUserId').value, payload = { name: $('newName').value, apps: selectedApps(), matriculasLogin: $('matriculasLogin').value, chatUsername: $('chatUsername').value };
    if (!id) { payload.username = $('newUsername').value; payload.password = $('newPassword').value; }
    try {
      await request(id ? `/api/portal/users/${encodeURIComponent(id)}` : '/api/portal/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeForm(); await loadUsers(); toast('Usuário salvo.');
    } catch (err) { $('userError').textContent = err.message; show($('userError'), true); }
  });
  $('tutorProvisionForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('tutorInitialPassword').value;
    if (!password) {
      $('tutorProvisionError').textContent = 'Informe a senha inicial dos tutores.'; show($('tutorProvisionError'), true); return;
    }
    const list = tutorCandidates.map(tutor => `• ${tutor.name} — ${tutor.polo} — ${tutor.username}`).join('\n');
    if (!confirm(`Criar uma conta central de Matrículas para cada tutor listado, usando a mesma senha inicial?\n\n${list}\n\nCada conta terá consulta do polo e acesso individual às matrículas do tutor.`)) return;
    const button = $('createTutorUsersBtn'); button.disabled = true; show($('tutorProvisionError'), false);
    try {
      const result = await request('/api/portal/tutor-users', { method: 'POST', body: JSON.stringify({ password }) });
      $('tutorProvisionForm').reset(); show($('tutorProvision'), false); await loadUsers();
      const skipped = result.existing?.length || 0;
      toast(`${result.created.length} acessos criados${skipped ? `; ${skipped} já existiam` : ''}.`);
    } catch (error) {
      $('tutorProvisionError').textContent = error.message; show($('tutorProvisionError'), true);
    } finally { button.disabled = false; }
  });
  async function resetPassword(user) {
    const password = prompt(`Nova senha para ${user.name} (mínimo de 12 caracteres):`); if (password === null) return;
    try { await request(`/api/portal/users/${encodeURIComponent(user.id)}/password`, { method: 'POST', body: JSON.stringify({ password }) }); if (user.id === me.id) { me = null; render(); $('loginUsername').value = user.username; toast('Senha atualizada. Entre novamente.'); } else toast('Senha atualizada.'); }
    catch (err) { toast(err.message, true); }
  }
  async function toggleActive(user) {
    const active = !user.active;
    if (!confirm(`${active ? 'Ativar' : 'Desativar'} o acesso de ${user.name}?`)) return;
    try { await request(`/api/portal/users/${encodeURIComponent(user.id)}/active`, { method: 'POST', body: JSON.stringify({ active }) }); await loadUsers(); toast(active ? 'Usuário ativado.' : 'Usuário desativado.'); }
    catch (err) { toast(err.message, true); }
  }
  render();
  refresh().catch(err => { $('loginError').textContent = err.message; show($('loginError'), true); });
})();
