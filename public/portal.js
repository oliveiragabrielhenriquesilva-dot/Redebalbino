(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const apps = {
    matriculas: { title: 'Acompanhamento de Matrículas', desc: 'Acompanhe matrículas, metas, polos, tutores e relatórios.', href: '/matriculas/', icon: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5.5 7.5h8a4 4 0 0 1 4 4v14a4 4 0 0 0-4-4h-8v-14Z"/><path d="M26.5 7.5h-8a4 4 0 0 0-1 0v18a4 4 0 0 1 4-4h5v-14Z"/><path d="m10 13 2.2 2.2L15 12"/></svg>', color: 'blue' },
    oportunidades: { title: 'Balbino Oportunidades', desc: 'Leads de inscrição, atendimentos, retornos e conversão por RA.', href: '/oportunidades/', icon: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="13" cy="11" r="5"/><path d="M4 27v-2a8 8 0 0 1 8-8h2M21 8v8M17 12h8M20 25h8M24 21v8"/></svg>', color: 'violet' },
    artes: { title: 'Gerador de Artes', desc: 'Crie peças de divulgação usando os modelos da equipe.', href: '/artes/', icon: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="5" width="22" height="22" rx="4"/><circle cx="12" cy="12" r="2.2"/><path d="m7 24 7-7 4 4 3-3 4 4M22.5 5.5l4 4M20 8l-9 9-1 4 4-1 9-9"/></svg>', color: 'violet' },
    chat: { title: 'Balbino Chat', desc: 'Centralize os atendimentos acadêmicos pelo WhatsApp.', href: '/chat/', icon: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M26.5 15.3a10.5 10.5 0 0 1-15.7 9.1L5 26l1.7-5.3a10.5 10.5 0 1 1 19.8-5.4Z"/><path d="M11 12.5c.5 3.5 3 6 6.5 6.5M12 11l2 2-1.2 1.6M20.7 19l-2-2 1.6-1.2"/></svg>', color: 'teal' },
    informa: { title: 'Balbino Informa', desc: 'Calendário acadêmico Unicesumar: provas, atividades e prazos por curso e módulo.', href: '/informa/', icon: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 7.5h20v17H6z"/><path d="M10 4.5v6M22 4.5v6M6 12.5h20M10 17h4M18 17h4M10 21h4"/></svg>', color: 'cyan' }
  };
  const shortcuts = {
    matriculas: [['Painel do processo', '/matriculas/']],
    oportunidades: [['Retornos vencidos', '/oportunidades/?retorno=vencido&aba=candidatos'], ['Sem contato', '/oportunidades/?contato=sem&aba=candidatos'], ['Painel gerencial', '/oportunidades/']],
    informa: [['O que acontece esta semana', '/informa/'], ['Buscar no calendário', '/informa/#busca']]
  };
  const labels = { matriculas: 'CAPTAÇÃO', oportunidades: 'LEADS E INSCRIÇÕES', informa: 'CONSULTA', artes: 'CRIAÇÃO', chat: 'ATENDIMENTO' };
  let me = null, users = [], tutorCandidates = [];
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
    show($('loginView'), !logged && $('setupWarning').dataset.configured !== 'false');
    show($('changePasswordView'), mustChangePassword);
    show($('dashboardView'), logged && !mustChangePassword);
    show($('logoutBtn'), logged);
    if (!logged || mustChangePassword) return;
    $('userName').textContent = me.name;
    show($('manageUsersBtn'), me.isAdmin);
    const grid = $('appGrid'); grid.replaceChildren();
    const allowed = new Set(me.apps || []);
    const hasMatriculas = me.isAdmin || allowed.has('matriculas');
    const availableApps = [...(hasMatriculas ? ['matriculas', 'oportunidades'] : []), 'informa'];
    const hour = new Date().getHours();
    $('greeting').textContent = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('todayLabel').textContent = today.charAt(0).toUpperCase() + today.slice(1);
    for (const key of availableApps) {
      const app = apps[key]; if (!app) continue;
      const card = document.createElement('article'); card.className = `app-card app-${key}`;
      const top = document.createElement('div'); top.className = 'app-card-top';
      const icon = document.createElement('div'); icon.className = 'app-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = app.icon;
      const label = document.createElement('span'); label.className = 'app-number'; label.textContent = labels[key] || '';
      const title = document.createElement('h2'); title.textContent = app.title;
      const desc = document.createElement('p'); desc.textContent = app.desc;
      const quick = document.createElement('div'); quick.className = 'app-shortcuts';
      for (const [text, href] of (shortcuts[key] || []).slice(key === 'matriculas' ? 1 : 0)) { const a = document.createElement('a'); a.href = href; a.textContent = text; quick.append(a); }
      const link = document.createElement('a'); link.className = 'app-link'; link.href = app.href; link.textContent = 'Acessar sistema';
      const arrow = document.createElement('span'); arrow.textContent = '↗'; link.append(arrow);
      top.append(icon, label); card.append(top, title, desc); if (quick.childElementCount) card.append(quick); card.append(link); grid.append(card);
    }
    loadToday(hasMatriculas);
    show($('emptyState'), availableApps.length === 0);
  }
  // Resumo do processo com os números do Acompanhamento de Matrículas (mesmo cálculo do painel do Matrículas).
  async function loadToday(enabled) {
    const panel = $('todayPanel');
    if (!enabled) { show(panel, false); return; }
    try {
      const d = await request('/matriculas/api/resumo-portal');
      if (!d.ciclo) { show(panel, false); return; }
      const n = v => v == null ? '—' : Math.round(v).toLocaleString('pt-BR');
      const sig = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('pt-BR');
      const br = iso => iso ? iso.split('-').reverse().slice(0, 2).join('/') : '';
      const pct = d.percentual_meta == null ? '' : ` (${d.percentual_meta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da meta)`;
      const sp = d.proximo_space;
      const tiles = [
        ['Matrículas no processo', n(d.matriculas), d.meta ? `de ${n(d.meta)}${pct}` : 'meta não cadastrada', ''],
        ['Saldo de hoje (gap)', d.hoje.saldo == null ? '—' : sig(d.hoje.saldo), d.hoje.esperado == null ? (d.aguardando_spaces ? 'cadastre os Spaces para calcular o esperado' : 'sem esperado para hoje') : `${n(d.hoje.realizado)} realizadas × ${n(d.hoje.esperado)} esperadas`, d.hoje.saldo == null ? '' : d.hoje.saldo < 0 ? 'alert' : 'good'],
        [sp ? (sp.final ? 'Meta final' : `Próximo Space · ${sp.nome}`) : 'Próximo Space', sp && sp.falta != null ? n(sp.falta) : '—', sp ? `faltam até ${br(sp.data)}${sp.por_dia != null ? ` · ${sp.por_dia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por dia` : ''}` : 'nenhum Space cadastrado', sp && sp.falta === 0 ? 'good' : ''],
        ['Matrículas hoje', n(d.vendas_dia), `${n(d.vendas_semana)} na semana de meta`, '']
      ];
      const grid = $('todayGrid'); grid.replaceChildren();
      for (const [label, value, sub, cls] of tiles) {
        const a = document.createElement('a'); a.className = 'today-tile ' + cls; a.href = '/matriculas/';
        const l = document.createElement('span'); l.textContent = label;
        const v = document.createElement('strong'); v.textContent = value;
        const s2 = document.createElement('small'); s2.textContent = sub;
        a.append(l, v, s2); grid.append(a);
      }
      const processoNome = String(d.ciclo.nome || '').replace(/^\s*ciclo\s+/i, '').trim();
      $('todayTitle').textContent = `Processo ${processoNome || '51/2027'}${d.polo_restrito ? ' · ' + d.polo_restrito : ''}`;
      $('todayMeta').textContent = `Matrículas com RA confirmado, como no painel do Matrículas${d.pendentes_ra ? ` · ${n(d.pendentes_ra)} lançada(s) aguardando RA` : ''}`;
      show(panel, true);
    } catch { show(panel, false); }
  }
  async function refresh() {
    const data = await request('/api/portal/me');
    if (data.configured === false) {
      $('setupWarning').dataset.configured = 'false'; show($('setupWarning'), true); show($('loginView'), false); show($('dashboardView'), false); return;
    }
    $('setupWarning').dataset.configured = 'true'; show($('setupWarning'), false); me = data.user; render();
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('loginSubmit'), error = $('loginError');
    show(error, false); button.disabled = true;
    try {
      const data = await request('/api/portal/login', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
      me = data.user; $('loginPassword').value = ''; render();
      const next = new URL(location.href).searchParams.get('next');
      if (next) { try { const target = new URL(next, location.origin); if (target.origin === location.origin && /^\/(matriculas|oportunidades|informa)(?:\/|$)/.test(target.pathname)) location.assign(target.href); } catch {} }
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
      $('changePasswordForm').reset(); await refresh(); toast('Senha atualizada. As outras sessões foram encerradas.');
    } catch (err) { error.textContent = err.message; show(error, true); }
    finally { if (button) button.disabled = false; }
  });
  $('logoutBtn').addEventListener('click', async () => { try { await request('/api/portal/logout', { method: 'POST', body: '{}' }); } catch {} me = null; render(); });
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
  refresh().catch(err => { $('loginError').textContent = err.message; show($('loginError'), true); });
})();
