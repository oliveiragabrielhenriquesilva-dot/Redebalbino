// Painel do Automatizador de Publicações — Polos UniCesumar
const app = document.getElementById('app');
const S = { tipos: [], polos: [], estado: {} };

// ---------- utilidades ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) { location.reload(); throw new Error(j.erro); } // sessão expirou: volta para a tela de senha
  if (!r.ok) throw new Error(j.erro || 'Algo deu errado.');
  return j;
}
let avisoTimer;
function aviso(msg, ruim = false) {
  const el = document.getElementById('aviso');
  el.textContent = msg; el.className = 'mostrar' + (ruim ? ' ruim' : '');
  clearTimeout(avisoTimer); avisoTimer = setTimeout(() => (el.className = ''), ruim ? 6000 : 3000);
}
async function ocupado(botao, fn) {
  const txt = botao.innerHTML; botao.disabled = true; botao.innerHTML = '<span class="carregando"></span> Aguarde…';
  try { return await fn(); } catch (e) { aviso(e.message, true); } finally { botao.disabled = false; botao.innerHTML = txt; }
}
function dataBR(dt) {
  if (!dt) return 'Sem data';
  const [d, h] = dt.split('T'); const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}${h ? ' às ' + h : ''}`;
}
const STATUS = { rascunho: 'Para aprovar', aprovada: 'Aprovada', publicada: 'Publicada', erro: 'Com erro' };
const FORMATO = { feed: 'Feed', story: 'Story' };
async function carregarBase() {
  [S.tipos, S.polos, S.estado] = await Promise.all([api('GET', '/api/tipos'), api('GET', '/api/polos'), api('GET', '/api/estado')]);
  if (!S.icones) { const r = await api('GET', '/api/icones'); S.icones = r.icones; S.areas = r.areas; }
}
// Seletor de ícone: busca + grade agrupada por área (caixa com rolagem)
function seletorIcone(atual, campo, comAuto = false) {
  const btn = (k, v) => `<button type="button" class="ic ${k === atual ? 'sel' : ''}" data-ic="${k}" data-nome="${esc(v.nome.toLowerCase())}" title="${esc(v.nome)}" aria-label="${esc(v.nome)}" aria-pressed="${k === atual}">${v.svg}</button>`;
  const grupos = S.areas.map((nome, i) => {
    const itens = Object.entries(S.icones).filter(([, v]) => v.area === i);
    return itens.length ? `<div class="ic-grupo"><div class="ic-area">${esc(nome)}</div><div class="icones-grade">${itens.map(([k, v]) => btn(k, v)).join('')}</div></div>` : '';
  }).join('');
  const atualNome = atual && S.icones[atual] ? S.icones[atual].nome : (comAuto ? 'Automático pelo nome do curso' : '');
  return `<div class="icones" data-campo="${esc(campo)}">
    <div class="ic-topo"><input type="search" class="ic-busca" placeholder="Buscar ícone (ex.: saúde, livro, carro)" aria-label="Buscar ícone">
      ${comAuto ? `<button type="button" class="ic auto ${!atual ? 'sel' : ''}" data-ic="" title="Automático pelo nome do curso" aria-pressed="${!atual}">Auto</button>` : ''}
      <span class="ic-atual">${esc(atualNome)}</span></div>
    <div class="ic-lista">${grupos}</div></div>`;
}
function ligarIcones(grade, aoEscolher) {
  const busca = grade.querySelector('.ic-busca');
  busca.oninput = () => {
    const q = busca.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    grade.querySelectorAll('.ic-lista .ic').forEach(b => { b.hidden = q && !b.dataset.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); });
    grade.querySelectorAll('.ic-grupo').forEach(g => { g.hidden = !g.querySelector('.ic:not([hidden])'); });
  };
  grade.onclick = e => {
    const b = e.target.closest('[data-ic]'); if (!b) return;
    grade.querySelectorAll('[data-ic]').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', x === b); });
    grade.querySelector('.ic-atual').textContent = b.dataset.ic ? S.icones[b.dataset.ic].nome : 'Automático pelo nome do curso';
    aoEscolher && aoEscolher(b.dataset.ic);
  };
}
const iconeEscolhido = grade => (grade.querySelector('[data-ic].sel') || {}).dataset?.ic || '';

// ---------- roteador ----------
const telas = { inicio, nova, publicacoes, automacoes, cursos, tutoras, empresas, polos, tipos, config };
async function navegar() {
  const rota = (location.hash.replace('#/', '') || 'inicio').split('?')[0];
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('ativo', a.dataset.rota === rota));
  try { await carregarBase(); document.querySelector('.marca span').textContent = `Automatizador de publicações · versão ${S.estado.versao || '?'}`; await (telas[rota] || inicio)(); }
  catch (e) { app.innerHTML = `<div class="cartao erro-txt">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', navegar);
navegar();

// ---------- Início ----------
async function inicio() {
  const pubs = await api('GET', '/api/publicacoes');
  const agora = S.estado.agora;
  const conta = s => pubs.filter(p => p.status === s).length;
  const paraPostar = pubs.filter(p => p.status === 'aprovada' && p.data_hora && p.data_hora <= agora && !p.meta_pronta);
  const proximas = pubs.filter(p => p.status === 'aprovada' && p.data_hora > agora).sort((a, b) => a.data_hora.localeCompare(b.data_hora)).slice(0, 6);
  app.innerHTML = `
    <h1>Bom trabalho por aqui</h1>
    <p class="sub">Resumo das publicações dos polos.</p>
    ${!S.estado.navegador ? `<div class="cartao erro-txt" style="margin-bottom:16px">Não encontrei o Edge nem o Chrome neste computador, e eles são necessários para gerar as artes. Informe o caminho em <a href="#/config">Configurações</a>.</div>` : ''}
    <div class="grade g4" style="margin-bottom:24px">
      <a class="cartao" href="#/publicacoes?s=rascunho" style="text-decoration:none;color:inherit"><div class="numero">${conta('rascunho')}</div><div class="rotulo">Para aprovar</div></a>
      <a class="cartao" href="#/publicacoes?s=aprovada" style="text-decoration:none;color:inherit"><div class="numero">${conta('aprovada')}</div><div class="rotulo">Aprovadas e agendadas</div></a>
      <a class="cartao" href="#/publicacoes?s=publicada" style="text-decoration:none;color:inherit"><div class="numero">${conta('publicada')}</div><div class="rotulo">Publicadas</div></a>
      <a class="cartao" href="#/publicacoes?s=erro" style="text-decoration:none;color:inherit"><div class="numero">${conta('erro')}</div><div class="rotulo">Com erro</div></a>
    </div>
    ${paraPostar.length ? `<div class="cartao" style="margin-bottom:24px;border-color:var(--alerta)">
      <h2>Hora de postar (${paraPostar.length})</h2>
      <p class="sub" style="margin-bottom:12px">Estas publicações chegaram no horário. Enquanto o Instagram não estiver conectado, baixe a arte, copie a legenda e poste.</p>
      <div class="pubs" id="lista-postar"></div></div>` : ''}
    <div class="cartao">
      <div class="linha-polo" style="margin-bottom:12px"><h2 style="margin:0">Próximas publicações</h2><a class="btn prim" href="#/nova">Nova publicação</a></div>
      ${proximas.length ? proximas.map(p => `<div class="linha-polo secao" style="margin-top:10px;padding-top:10px"><div><strong>${esc(p.tipo_nome)}</strong> · ${esc(FORMATO[p.formato])} · Polo ${esc(p.polo_nome)}</div><div class="meta">${dataBR(p.data_hora)}</div></div>`).join('') : '<p class="vazio" style="padding:20px">Nada agendado ainda.</p>'}
    </div>`;
  if (paraPostar.length) desenharPubs(document.getElementById('lista-postar'), paraPostar, inicio);
}

// ---------- Nova publicação ----------
async function nova() {
  const listaCursos = (await api('GET', '/api/cursos')).filter(c => c.curso);
  const tiposAtivos = S.tipos.filter(t => t.ativo);
  const polosAtivos = S.polos.filter(p => p.ativo);
  const tutorasAtivas = (await api('GET', '/api/tutoras')).filter(t => t.ativo);
  const f = { tipo: tiposAtivos[0]?.id, destino: 'polos', polos: polosAtivos.map(p => p.id), tutoras: tutorasAtivas.map(t => t.id), formatos: [], dados: {}, data_hora: '', modelo: '', previaPolo: polosAtivos[0]?.id, previaTutora: tutorasAtivas[0]?.id, previaFormato: '', porCurso: false, cursos: [], cursoDados: {} };
  // Tipos que aceitam "uma arte para cada curso" (o preço sai de cada curso cadastrado)
  const ACEITA_CURSOS = ['curso', 'oferta', 'black', 'esquenta'];
  const cursosDoTipo = t => listaCursos.filter(c => t.id === 'esquenta' ? true : t.id === 'curso' ? c.ativo : c.preco_desconto);
  const campanhasDoTipo = t => [...new Set(cursosDoTipo(t).map(c => c.campanha).filter(Boolean))];
  const dadosPrevia = () => (f.porCurso && f.cursos.length && f.cursoDados[f.cursos[0]] ? { ...f.dados, ...f.cursoDados[f.cursos[0]] } : f.dados);
  async function carregarCursos() {
    await Promise.all(f.cursos.filter(id => !f.cursoDados[id]).map(async id => { f.cursoDados[id] = await api('GET', `/api/cursos/${id}/dados?tipo=${f.tipo}`); }));
  }
  // Abas Comercial / Pedagógico: lembra a última usada neste computador
  const GRUPOS = [['comercial', 'Comercial'], ['pedagogico', 'Pedagógico']];
  const grupoDe = t => (t && t.grupo === 'pedagogico' ? 'pedagogico' : 'comercial');
  let grupoSalvo = ''; try { grupoSalvo = localStorage.getItem('grupo_nova') || ''; } catch {}
  f.grupo = GRUPOS.some(([g]) => g === grupoSalvo) && tiposAtivos.some(t => grupoDe(t) === grupoSalvo) ? grupoSalvo : grupoDe(tiposAtivos[0]);
  f.tipo = (tiposAtivos.find(t => grupoDe(t) === f.grupo) || tiposAtivos[0])?.id;
  const tipoAtual = () => S.tipos.find(t => t.id === f.tipo);
  function trocarTipo(id) {
    f.tipo = id; const t = tipoAtual();
    f.formatos = [...t.formatos_disponiveis]; f.previaFormato = f.formatos[0];
    f.dados = {}; for (const c of t.campos) f.dados[c.chave] = c.padrao || '';
    f.modelo = t.legenda_padrao;
    f.porCurso = false; f.cursos = []; f.cursoDados = {};
    if ((id === 'tutora' || id === 'empresas') && tutorasAtivas.length) f.destino = 'tutoras';
  }
  trocarTipo(f.tipo);

  app.innerHTML = `
    <h1>Nova publicação</h1>
    <p class="sub">Preencha uma vez e o sistema gera a arte e a legenda para cada polo e formato escolhidos.</p>
    <div class="nova">
      <div class="cartao" id="form"></div>
      <div class="previa">
        <div class="cartao">
          <div class="linha-polo" style="margin-bottom:12px"><h2 style="margin:0">Prévia</h2>
            <div class="acoes"><select id="pv-polo" aria-label="Polo da prévia" style="width:auto"></select><select id="pv-formato" aria-label="Formato da prévia" style="width:auto"></select></div></div>
          <div class="moldura" id="moldura"><iframe id="pv" title="Prévia da arte" scrolling="no"></iframe></div>
          <h2 style="margin-top:18px">Legenda</h2>
          <div class="legenda-previa" id="pv-legenda"></div>
        </div>
      </div>
    </div>`;

  const form = document.getElementById('form');
  function desenharForm() {
    const t = tipoAtual();
    form.innerHTML = `
      <div class="abas" style="margin-bottom:14px">${GRUPOS.map(([g, n]) => `<button type="button" data-grupo="${g}" class="${f.grupo === g ? 'ativo' : ''}">${n} <span class="ajuda">(${tiposAtivos.filter(x => grupoDe(x) === g).length})</span></button>`).join('')}</div>
      <div class="campo"><label>Tipo de publicação</label><div class="opcoes">
        ${tiposAtivos.filter(x => grupoDe(x) === f.grupo).map(x => `<label class="opcao ${x.id === f.tipo ? 'sel' : ''}"><input type="radio" name="tipo" value="${x.id}" ${x.id === f.tipo ? 'checked' : ''}><span><strong>${esc(x.nome)}</strong><small>${esc(x.descricao)}</small></span></label>`).join('')}
      </div></div>
      <div class="campo"><label>Gerar para</label><div class="chips">
        <label class="chip"><input type="radio" name="destino" value="polos" ${f.destino === 'polos' ? 'checked' : ''}> Instagram dos polos</label>
        <label class="chip"><input type="radio" name="destino" value="tutoras" ${f.destino === 'tutoras' ? 'checked' : ''} ${tutorasAtivas.length ? '' : 'disabled'}> Uma arte para cada tutora</label>
        ${tutorasAtivas.length ? '' : '<span class="ajuda" style="align-self:center">Cadastre as tutoras na tela <a href="#/tutoras">Tutoras</a>.</span>'}
      </div></div>
      <div class="duas">
        ${f.destino === 'polos' ? `<div class="campo"><label>Polos</label><div class="chips">
          ${polosAtivos.map(p => `<label class="chip"><input type="checkbox" name="polo" value="${p.id}" ${f.polos.includes(p.id) ? 'checked' : ''}> ${esc(p.nome)}</label>`).join('') || '<span class="ajuda">Cadastre um polo primeiro.</span>'}
        </div></div>` : `<div class="campo"><label>Tutoras <span class="ajuda">(o rodapé e o QR usam o WhatsApp de cada uma)</span></label><div class="chips">
          ${tutorasAtivas.map(x => `<label class="chip"><input type="checkbox" name="tutora" value="${x.id}" ${f.tutoras.includes(x.id) ? 'checked' : ''}> ${esc(x.nome)} <span class="ajuda">· ${esc(x.polo_nome || '')}</span></label>`).join('')}
        </div></div>`}
        <div class="campo"><label>Formatos</label><div class="chips">
          ${t.formatos_disponiveis.map(x => `<label class="chip"><input type="checkbox" name="formato" value="${x}" ${f.formatos.includes(x) ? 'checked' : ''}> ${FORMATO[x]}</label>`).join('')}
          ${t.templates_faltando && t.templates_faltando.length ? `<span class="erro-txt" style="display:block">Faltam arquivos na pasta templates: ${esc(t.templates_faltando.join(', '))}. Feche a janela preta e abra o Iniciar.bat de novo; se continuar, extraia o zip outra vez.</span>` : ''}
        </div></div>
      </div>
      <div class="secao"><h2>Conteúdo da arte</h2>
      ${['curso', 'oferta', 'black', 'esquenta'].includes(t.id) && !f.porCurso && listaCursos.length ? `<div class="campo" style="max-width:420px"><label for="usar-curso">Preencher com um curso cadastrado${t.id === 'black' ? ' <span class="ajuda">(opcional: sem curso, sai a oferta geral)</span>' : t.id === 'esquenta' ? ' <span class="ajuda">(opcional: sem curso, sai o Esquenta geral)</span>' : ''}</label><select id="usar-curso"><option value="">Escolha um curso…</option>${cursosDoTipo(t).map(c => `<option value="${c.id}">${esc(c.curso)}${c.linha1 ? ' · ' + esc(c.linha1) : ''}${['oferta', 'black'].includes(t.id) ? ' · ' + esc(c.preco_desconto) : ''}</option>`).join('')}</select></div>` : ''}
      ${ACEITA_CURSOS.includes(t.id) && cursosDoTipo(t).length ? `<div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="por-curso" ${f.porCurso ? 'checked' : ''}> Uma arte para cada curso</label>
        <span class="ajuda">${t.id === 'curso' ? 'Cada curso marcado gera a própria arte.' : t.id === 'esquenta' ? 'Cada curso marcado gera o próprio Esquenta, com o nome e o ícone do curso (sem preço). Os demais textos abaixo valem para todos.' : 'Cada curso marcado gera a própria arte, com o preço dele (cadastrado em Cursos). Os demais textos abaixo valem para todos.'}</span>
        ${f.porCurso ? `<div class="chips" style="margin-top:8px">${cursosDoTipo(t).map(c => `<label class="chip"><input type="checkbox" name="curso-lote" value="${c.id}" ${f.cursos.includes(c.id) ? 'checked' : ''}> ${esc(c.curso)}${c.linha1 ? ' <span class="ajuda">· ' + esc(c.linha1) + '</span>' : ''}</label>`).join('')}</div>
        <div class="acoes" style="margin-top:6px">${campanhasDoTipo(t).map(g => `<button type="button" class="btn" data-campanha="${esc(g)}">Só ${esc(g)}</button>`).join('')}<button type="button" class="btn" id="cursos-todos">Marcar todos</button><button type="button" class="btn" id="cursos-nenhum">Desmarcar</button></div>` : ''}</div>` : ''}
      <div class="duas">
        ${t.campos.filter(c => c.tipo !== 'icone' && !(f.porCurso && ['linha1', 'linha2', 'curso', 'primeira', 'desconto', 'preco_cheio', 'mensalidade', 'nivel', 'detalhe'].includes(c.chave))).map(c => `<div class="campo"><label for="c-${c.chave}">${esc(c.rotulo)}</label><input id="c-${c.chave}" data-campo="${c.chave}" type="${c.tipo === 'date' ? 'date' : 'text'}" value="${esc(f.dados[c.chave] || '')}"></div>`).join('')}
      </div>
      ${t.campos.filter(c => c.tipo === 'icone').map(c => `<div class="campo"><label>${esc(c.rotulo)}</label>${seletorIcone(f.dados[c.chave] ?? c.padrao, c.chave, true)}</div>`).join('')}
      </div>
      <div class="secao"><h2>Quando publicar</h2>
        <div class="campo" style="max-width:320px"><label for="quando">Data e hora <span class="ajuda">(pode deixar em branco e definir depois)</span></label><input type="datetime-local" id="quando" value="${esc(f.data_hora)}"></div></div>
      <div class="secao"><h2>Modelo da legenda</h2>
        <p class="ajuda" style="margin-top:-6px">As variáveis entre chaves são trocadas pelos dados de cada polo. Clique numa variável para inserir.</p>
        <div class="chips" style="margin-bottom:8px">${['polo', 'tutora', 'whatsapp', 'endereco', 'horario', 'instagram', ...t.campos.map(c => c.chave), ...(t.campos.some(c => c.chave === 'contagem') ? ['contagem_frase'] : []), ...(t.id === 'black' ? ['curso_frase', 'validade_frase'] : t.id === 'esquenta' ? ['curso_frase'] : [])].map(v => `<button type="button" class="var" data-var="${v}">{${v}}</button>`).join('')}</div>
        <textarea id="modelo">${esc(f.modelo)}</textarea></div>
      <div class="secao acoes"><button class="btn prim" id="gerar" type="button">Gerar artes</button>
        <span class="ajuda" id="resumo" style="align-self:center"></span></div>`;

    form.querySelectorAll('[data-grupo]').forEach(b => b.onclick = () => {
      if (b.dataset.grupo === f.grupo) return;
      f.grupo = b.dataset.grupo; try { localStorage.setItem('grupo_nova', f.grupo); } catch {}
      const primeiro = tiposAtivos.find(x => grupoDe(x) === f.grupo);
      if (primeiro) trocarTipo(primeiro.id);
      desenharForm(); atualizar();
    });
    form.querySelectorAll('input[name=tipo]').forEach(r => r.onchange = () => { trocarTipo(r.value); desenharForm(); atualizar(); });
    form.querySelectorAll('input[name=destino]').forEach(r => r.onchange = () => { f.destino = r.value; desenharForm(); atualizar(); });
    form.querySelectorAll('input[name=tutora]').forEach(c => c.onchange = () => { f.tutoras = [...form.querySelectorAll('input[name=tutora]:checked')].map(x => Number(x.value)); atualizar(); });
    form.querySelectorAll('input[name=polo]').forEach(c => c.onchange = () => { f.polos = [...form.querySelectorAll('input[name=polo]:checked')].map(x => Number(x.value)); atualizar(); });
    form.querySelectorAll('input[name=formato]').forEach(c => c.onchange = () => { f.formatos = [...form.querySelectorAll('input[name=formato]:checked')].map(x => x.value); atualizar(); });
    form.querySelectorAll('[data-campo]').forEach(i => i.oninput = () => { f.dados[i.dataset.campo] = i.value; atualizarDepois(); });
    const porCurso = document.getElementById('por-curso');
    // Ao ligar "uma arte para cada curso", já vêm marcados os cursos da campanha (se houver)
    if (porCurso) porCurso.onchange = async () => {
      f.porCurso = porCurso.checked;
      const grupo = campanhasDoTipo(t)[0];
      if (f.porCurso && !f.cursos.length && grupo) { await marcarCursos(cursosDoTipo(t).filter(c => c.campanha === grupo).map(c => c.id)); return; }
      desenharForm(); atualizar();
    };
    form.querySelectorAll('[data-campanha]').forEach(bt => bt.onclick = () => marcarCursos(cursosDoTipo(t).filter(c => c.campanha === bt.dataset.campanha).map(c => c.id)));
    const marcarCursos = async ids => { f.cursos = ids; try { await carregarCursos(); } catch (e) { aviso(e.message, true); } desenharForm(); atualizar(); };
    form.querySelectorAll('input[name=curso-lote]').forEach(c => c.onchange = () => marcarCursos([...form.querySelectorAll('input[name=curso-lote]:checked')].map(x => Number(x.value))));
    const todos = document.getElementById('cursos-todos'); if (todos) todos.onclick = () => marcarCursos(cursosDoTipo(t).map(c => c.id));
    const nenhum = document.getElementById('cursos-nenhum'); if (nenhum) nenhum.onclick = () => marcarCursos([]);
    const usar = document.getElementById('usar-curso');
    if (usar) usar.onchange = async () => {
      if (!usar.value) return;
      try { Object.assign(f.dados, await api('GET', `/api/cursos/${usar.value}/dados?tipo=${t.id}`)); } catch (e) { aviso(e.message, true); return; }
      desenharForm(); atualizar();
    };
    document.getElementById('quando').oninput = e => { f.data_hora = e.target.value; if (t.campos.some(c => c.chave === 'contagem')) atualizarDepois(); };
    const modelo = document.getElementById('modelo');
    modelo.oninput = () => { f.modelo = modelo.value; atualizarDepois(); };
    form.querySelectorAll('[data-var]').forEach(b => b.onclick = () => {
      const ins = `{${b.dataset.var}}`; const i = modelo.selectionStart ?? modelo.value.length;
      modelo.value = modelo.value.slice(0, i) + ins + modelo.value.slice(modelo.selectionEnd ?? i); f.modelo = modelo.value;
      modelo.focus(); modelo.selectionStart = modelo.selectionEnd = i + ins.length; atualizarDepois();
    });
    form.querySelectorAll('.icones').forEach(g => ligarIcones(g, k => { f.dados[g.dataset.campo] = k; atualizar(); }));
    document.getElementById('gerar').onclick = e => ocupado(e.currentTarget, async () => {
      f.modelo = modelo.value;
      const r = await api('POST', '/api/publicacoes', { tipo: f.tipo, destino: f.destino, polos: f.polos, tutoras: f.tutoras, formatos: f.formatos, dados: f.dados, data_hora: f.data_hora, modelo_legenda: f.modelo, cursos: f.porCurso ? f.cursos : [] });
      if (r.erros.length) aviso(`${r.criadas} publicações criadas, mas houve erro ao gerar: ${r.erros[0]}`, true);
      else aviso(`${r.criadas} ${r.criadas === 1 ? 'arte gerada' : 'artes geradas'}.${f.destino === 'tutoras' ? ' Baixe todas em zip e envie para as tutoras.' : ' Revise e aprove.'}`);
      // Abre só o lote recém-gerado: dá para revisar, aprovar todas e baixar o .zip só dessas artes
      location.hash = '#/publicacoes?lote=' + r.lote;
    });
  }

  const pvPolo = document.getElementById('pv-polo'), pvFormato = document.getElementById('pv-formato');
  pvPolo.onchange = () => { if (f.destino === 'tutoras') f.previaTutora = Number(pvPolo.value); else f.previaPolo = Number(pvPolo.value); atualizar(); };
  pvFormato.onchange = () => { f.previaFormato = pvFormato.value; atualizar(); };
  let t1;
  const atualizarDepois = () => { clearTimeout(t1); t1 = setTimeout(atualizar, 350); };
  async function atualizar() {
    const t = tipoAtual();
    const polosSel = polosAtivos.filter(p => f.polos.includes(p.id));
    const lista = polosSel.length ? polosSel : polosAtivos;
    if (!lista.find(p => p.id === f.previaPolo)) f.previaPolo = lista[0]?.id;
    let previaTutora = null;
    if (f.destino === 'tutoras') {
      const sel = tutorasAtivas.filter(x => f.tutoras.includes(x.id)); const lt = sel.length ? sel : tutorasAtivas;
      if (!lt.find(x => x.id === f.previaTutora)) f.previaTutora = lt[0]?.id;
      previaTutora = lt.find(x => x.id === f.previaTutora) || null;
      if (previaTutora) f.previaPolo = previaTutora.polo_id;
      pvPolo.innerHTML = lt.map(x => `<option value="${x.id}" ${x.id === f.previaTutora ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
    } else pvPolo.innerHTML = lista.map(p => `<option value="${p.id}" ${p.id === f.previaPolo ? 'selected' : ''}>Polo ${esc(p.nome)}</option>`).join('');
    const fmts = f.formatos.length ? f.formatos : t.formatos_disponiveis;
    if (!fmts.includes(f.previaFormato)) f.previaFormato = fmts[0];
    pvFormato.innerHTML = fmts.map(x => `<option value="${x}" ${x === f.previaFormato ? 'selected' : ''}>${FORMATO[x]}</option>`).join('');
    const total = (f.destino === 'tutoras' ? f.tutoras.length : f.polos.length) * f.formatos.length * (f.porCurso ? f.cursos.length : 1);
    const resumo = document.getElementById('resumo'); if (resumo) resumo.textContent = total ? `Serão geradas ${total} ${total === 1 ? 'arte' : 'artes'}.${f.porCurso && f.cursos.length > 1 ? ' A prévia mostra o primeiro curso marcado.' : ''}` : (f.porCurso && !f.cursos.length ? 'Marque os cursos.' : 'Escolha polos e formatos.');
    if (!f.previaPolo || !f.previaFormato) return;
    try {
      const [pv, lg] = await Promise.all([
        api('POST', '/api/previa', { tipo: f.tipo, polo_id: f.previaPolo, tutora_id: previaTutora ? previaTutora.id : null, formato: f.previaFormato, dados: dadosPrevia(), data_hora: f.data_hora }),
        api('POST', '/api/legenda', { tipo: f.tipo, polo_id: f.previaPolo, tutora_id: previaTutora ? previaTutora.id : null, dados: dadosPrevia(), modelo: f.modelo, data_hora: f.data_hora })
      ]);
      const ifr = document.getElementById('pv'), mold = document.getElementById('moldura');
      const escala = mold.clientWidth / pv.w;
      ifr.style.width = pv.w + 'px'; ifr.style.height = pv.h + 'px'; ifr.style.transform = `scale(${escala})`;
      mold.style.height = Math.round(pv.h * escala) + 'px';
      ifr.srcdoc = pv.html;
      document.getElementById('pv-legenda').textContent = lg.legenda;
    } catch (e) { aviso(e.message, true); }
  }
  desenharForm(); atualizar();
  window.onresize = atualizarDepois;
}

// ---------- Publicações ----------
async function publicacoes() {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const filtro = qs.get('s') || ''; const lote = qs.get('lote') || ''; const deTutoras = qs.get('t') === '1';
  const params = new URLSearchParams(); if (filtro) params.set('status', filtro); if (lote) params.set('lote', lote); if (deTutoras) params.set('tutoras', '1');
  const pubs = await api('GET', '/api/publicacoes' + (params.toString() ? '?' + params : ''));
  const comArte = pubs.filter(p => p.arquivo);
  const aprovaveis = pubs.filter(p => p.status === 'rascunho' && !p.tutora_id);
  app.innerHTML = `
    <div class="linha-polo"><div><h1>Publicações</h1><p class="sub">Revise, aprove e acompanhe cada arte.</p></div><a class="btn prim" href="#/nova">Nova publicação</a></div>
    <div class="abas">${[['', 'Todas'], ['rascunho', 'Para aprovar'], ['aprovada', 'Aprovadas'], ['publicada', 'Publicadas'], ['erro', 'Com erro'], ['t', 'Artes de tutoras']]
      .map(([s, n]) => `<button type="button" data-s="${s}" class="${(s === 't' ? deTutoras : s === filtro && !deTutoras && !lote) ? 'ativo' : ''}">${n}</button>`).join('')}
      ${lote ? '<button type="button" class="ativo">Artes recém-geradas</button>' : ''}
      ${aprovaveis.length && !deTutoras ? `<button type="button" id="aprovar-todas" style="margin-left:auto">Aprovar ${lote ? 'todas do lote' : 'todas'}</button>` : ''}
      ${comArte.length > 1 ? `<a class="btn peq" style="${aprovaveis.length && !deTutoras ? '' : 'margin-left:auto'}" href="/api/zip?ids=${comArte.map(p => p.id).join(',')}">Baixar ${comArte.length} artes (.zip)</a>` : ''}</div>
    ${lote ? `<p class="sub" style="margin-top:-4px">Lote com ${pubs.length} ${pubs.length === 1 ? 'arte' : 'artes'}. O .zip traz as imagens com o nome do curso e um legendas.txt com a legenda de cada uma.</p>` : ''}
    <div class="pubs" id="lista"></div>`;
  app.querySelectorAll('.abas [data-s]').forEach(b => b.onclick = () => (location.hash = '#/publicacoes' + (b.dataset.s === 't' ? '?t=1' : b.dataset.s ? '?s=' + b.dataset.s : '')));
  const todas = document.getElementById('aprovar-todas');
  if (todas) todas.onclick = () => ocupado(todas, async () => {
    for (const p of aprovaveis) await api('PUT', '/api/publicacoes/' + p.id, { status: 'aprovada' });
    aviso('Todas aprovadas.'); navegar();
  });
  desenharPubs(document.getElementById('lista'), pubs, navegar);
}

function desenharPubs(alvo, pubs, recarregar) {
  if (!pubs.length) { alvo.innerHTML = '<div class="vazio">Nenhuma publicação aqui.</div>'; return; }
  const agora = S.estado.agora;
  alvo.innerHTML = pubs.map(p => {
    const hora = p.status === 'aprovada' && p.data_hora && p.data_hora <= agora && !p.meta_pronta && !p.tutora_id;
    const img = p.arquivo ? `<img src="/artes/${esc(p.arquivo)}?v=${Date.now()}" alt="Arte ${esc(p.tipo_nome)} Polo ${esc(p.polo_nome)}">` : '<span>Sem arte gerada</span>';
    return `<article class="pub ${hora ? 'hora' : ''}" data-id="${p.id}">
      <div class="img ${p.formato === 'story' ? 'story' : ''}">${img}</div>
      <div class="corpo">
        <div class="linha-polo"><span class="selo s-${p.status}">${STATUS[p.status]}</span><span class="meta">${FORMATO[p.formato]}</span></div>
        <div><strong>${esc(p.tipo_nome)}${p.dados && p.dados.curso ? ': ' + esc(p.dados.curso) : ''}</strong><div class="meta">${p.tutora_nome ? 'Tutora ' + esc(p.tutora_nome) + ' · ' : ''}Polo ${esc(p.polo_nome)} · ${dataBR(p.data_hora)}${p.origem === 'automacao' ? ' · criada pela automação' : ''}</div></div>
        ${hora ? '<div class="alerta">Hora de postar: baixe a arte, copie a legenda e publique.</div>' : ''}
        ${p.tutora_id ? '<div class="meta">Arte da tutora: baixe e envie para ela postar.</div>' : ''}
        ${p.status === 'aprovada' && !p.meta_pronta && !hora && !p.tutora_id ? '<div class="meta">Instagram não conectado: no horário, o sistema avisa para você postar.</div>' : ''}
        ${p.status === 'aprovada' && p.meta_pronta && !hora ? '<div class="meta">Será publicada automaticamente no horário.</div>' : ''}
        ${p.whatsapp_channel_status === 'ENVIANDO' ? '<div class="meta">Enviando para o Canal do WhatsApp…</div>' : ''}
        ${p.whatsapp_channel_status === 'ENVIADA' ? `<div class="meta">Publicada no Canal ${esc(p.whatsapp_channel_name||'WhatsApp')}${p.whatsapp_channel_published_at ? ' · '+esc(p.whatsapp_channel_published_at) : ''}</div>` : ''}
        ${p.whatsapp_channel_status === 'ERRO' ? `<div class="erro-txt">Falha/retorno incerto no envio ao Canal: ${esc(p.whatsapp_channel_error||'Confira o canal e o registro no Balbino Chat antes de tentar novamente.')}</div>` : ''}
        ${p.erro ? `<div class="erro-txt">${esc(p.erro)}</div>` : ''}
        ${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">Ver no Instagram</a>` : ''}
        <details><summary>Legenda e horário</summary>
          <div class="campo" style="margin-top:10px"><label for="dh-${p.id}">Data e hora</label><input type="datetime-local" id="dh-${p.id}" value="${esc(p.data_hora)}"></div>
          <div class="campo"><label for="lg-${p.id}">Legenda</label><textarea id="lg-${p.id}">${esc(p.legenda)}</textarea></div>
          <button class="btn peq" data-acao="salvar" type="button">Salvar alterações</button>
        </details>
        <div class="acoes" style="margin-top:auto">
          ${p.arquivo ? `<a class="btn peq" href="/artes/${esc(p.arquivo)}?baixar=1">Baixar</a>` : ''}
          <button class="btn peq" data-acao="copiar" type="button">Copiar legenda</button>
          ${p.status === 'rascunho' ? '<button class="btn peq prim" data-acao="aprovar" type="button">Aprovar</button>' : ''}
          ${p.status === 'aprovada' || p.status === 'erro' ? '<button class="btn peq" data-acao="rascunho" type="button">Voltar para revisão</button>' : ''}
          ${p.status !== 'publicada' ? '<button class="btn peq" data-acao="publicada" type="button">Marcar como publicada</button>' : ''}
          ${p.meta_pronta && p.status !== 'publicada' ? '<button class="btn peq ciano" data-acao="publicar" type="button">Publicar agora</button>' : ''}
          <button class="btn peq" data-acao="gerar" type="button">Gerar de novo</button>
          <button class="btn peq perigo" data-acao="excluir" type="button">Excluir</button>
        </div>
      </div></article>`;
  }).join('');
  alvo.onclick = async e => {
    const b = e.target.closest('button[data-acao]'); if (!b) return;
    const card = b.closest('.pub'); const id = card.dataset.id; const p = pubs.find(x => String(x.id) === id);
    const acoes = {
      copiar: async () => { await navigator.clipboard.writeText(document.getElementById('lg-' + id).value); aviso('Legenda copiada.'); },
      salvar: async () => { await api('PUT', '/api/publicacoes/' + id, { legenda: document.getElementById('lg-' + id).value, data_hora: document.getElementById('dh-' + id).value }); aviso('Alterações salvas.'); recarregar(); },
      aprovar: async () => {
        const dh = document.getElementById('dh-' + id).value;
        await api('PUT', '/api/publicacoes/' + id, { status: 'aprovada', data_hora: dh });
        aviso(dh ? 'Aprovada e agendada.' : 'Aprovada. Defina a data e hora para agendar.'); recarregar();
      },
      rascunho: async () => { await api('PUT', '/api/publicacoes/' + id, { status: 'rascunho' }); recarregar(); },
      publicada: async () => { await api('PUT', '/api/publicacoes/' + id, { status: 'publicada' }); aviso('Marcada como publicada.'); recarregar(); },
      publicar: async () => { if (!confirm('Publicar agora no Instagram do polo ' + p.polo_nome + '?')) return; await api('POST', `/api/publicacoes/${id}/publicar`); aviso('Publicada no Instagram.'); recarregar(); },
      gerar: async () => { await api('POST', `/api/publicacoes/${id}/gerar`); aviso('Arte gerada de novo.'); recarregar(); },
      excluir: async () => { if (!confirm('Excluir esta publicação?')) return; await api('DELETE', '/api/publicacoes/' + id); recarregar(); }
    };
    await ocupado(b, acoes[b.dataset.acao]);
  };
}

// ---------- Automações ----------
async function automacoes() {
  const [c, auto] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/automacao')]);
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const lista = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const diasCurso = lista(c.cursos_dias);
  const chk = (k, rot) => `<label class="chip"><input type="checkbox" id="a-${k}" ${c[k] === '1' ? 'checked' : ''}> ${rot}</label>`;
  const fmts = (k, opcoes) => opcoes.map(f => `<label class="chip"><input type="checkbox" data-fmt="${k}" value="${f}" ${lista(c[k]).includes(f) ? 'checked' : ''}> ${FORMATO[f]}</label>`).join('');
  const dataBRc = d => d.split('-').reverse().join('/');
  app.innerHTML = `
    <h1>Automações</h1>
    <p class="sub">O sistema cria estas publicações sozinho, com arte e legenda, para todos os polos ativos. Ele verifica a cada hora e olha ${esc(c.horizonte_dias)} dias à frente.</p>
    <div class="grade">
      <div class="cartao"><div class="linha-polo"><h2 style="margin:0">Aviso de boleto (todo mês)</h2>${chk('boleto_ativo', 'Ligado')}</div>
        <div class="duas" style="margin-top:14px">
          <div class="campo"><label for="a-boleto_dia">Dia do vencimento</label><input type="text" inputmode="numeric" id="a-boleto_dia" value="${esc(c.boleto_dia)}"></div>
          <div class="campo"><label for="a-boleto_dias_antes">Avisar quantos dias antes <span class="ajuda">(ex.: 3 ou 3,0 para avisar também no dia)</span></label><input type="text" id="a-boleto_dias_antes" value="${esc(c.boleto_dias_antes)}"></div>
          <div class="campo"><label for="a-boleto_hora">Horário do post</label><input type="time" id="a-boleto_hora" value="${esc(c.boleto_hora)}"></div>
          <div class="campo"><label>Formatos</label><div class="chips">${fmts('boleto_formatos', ['feed'])}</div></div>
        </div>
        <p class="meta">Caindo em fim de semana ou feriado, o vencimento vai para o próximo dia útil. Próximos vencimentos:</p>
        <div class="chips">${auto.vencimentos.map(v => `<span class="chip" title="${v.adiado ? 'Dia ' + dataBRc(v.original) + ': ' + esc(v.motivo) : ''}">${dataBRc(v.data)}${v.adiado ? ' *' : ''}</span>`).join('')}</div>
        <p class="ajuda">* adiado por fim de semana ou feriado (passe o mouse para ver o motivo)</p>
      </div>
      <div class="cartao"><div class="linha-polo"><h2 style="margin:0">Arrasto de boleto (desconto até o dia limite)</h2>${chk('arrasto_ativo', 'Ligado')}</div>
        <div class="duas" style="margin-top:14px">
          <div class="campo"><label for="a-arrasto_dia">Dia limite do desconto</label><input type="text" inputmode="numeric" id="a-arrasto_dia" value="${esc(c.arrasto_dia)}"></div>
          <div class="campo"><label for="a-arrasto_dias_antes">Avisar quantos dias antes <span class="ajuda">(ex.: 5,1 avisa 5 dias antes e na véspera)</span></label><input type="text" id="a-arrasto_dias_antes" value="${esc(c.arrasto_dias_antes)}"></div>
          <div class="campo"><label for="a-arrasto_hora">Horário do post</label><input type="time" id="a-arrasto_hora" value="${esc(c.arrasto_hora)}"></div>
          <div class="campo"><label>Formatos</label><div class="chips">${fmts('arrasto_formatos', ['feed', 'story'])}</div></div>
        </div>
        <p class="meta">Mesma regra de dia útil. Próximos dias limite:</p>
        <div class="chips">${auto.arrasto.map(v => `<span class="chip" title="${v.adiado ? 'Dia ' + dataBRc(v.original) + ': ' + esc(v.motivo) : ''}">${dataBRc(v.data)}${v.adiado ? ' *' : ''}</span>`).join('')}</div>
      </div>
      <div class="cartao"><div class="linha-polo"><h2 style="margin:0">Rodízio de cursos</h2>${chk('cursos_ativo', 'Ligado')}</div>
        <p class="meta">Em cada dia escolhido, publica o próximo curso ativo da lista em <a href="#/cursos">Cursos</a>, sem repetir até passar por todos.</p>
        <div class="campo"><label>Dias da semana</label><div class="chips">${DIAS.map((d, i) => `<label class="chip"><input type="checkbox" data-dia value="${i}" ${diasCurso.includes(String(i)) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <div class="duas">
          <div class="campo"><label for="a-cursos_hora">Horário do post</label><input type="time" id="a-cursos_hora" value="${esc(c.cursos_hora)}"></div>
          <div class="campo"><label for="a-cursos_por_dia">Cursos por dia</label><input type="text" inputmode="numeric" id="a-cursos_por_dia" value="${esc(c.cursos_por_dia)}"></div>
          <div class="campo"><label>Formatos</label><div class="chips">${fmts('cursos_formatos', ['feed', 'story'])}</div></div>
          <div class="campo"><label for="a-cursos_modelo">Arte do rodízio</label><select id="a-cursos_modelo">
            ${[['alternar', 'Alternar: curso e oferta com preço'], ['curso', 'Só a arte do curso'], ['oferta', 'Só a oferta com preço']].map(([k, r]) => `<option value="${k}" ${(c.cursos_modelo || 'alternar') === k ? 'selected' : ''}>${r}</option>`).join('')}</select>
            <p class="ajuda">Curso sem mensalidade cadastrada sai sempre com a arte do curso.</p></div>
        </div></div>
      <div class="cartao"><h2>Geral</h2>
        <div class="campo">${chk('auto_aprovar', 'Aprovar automaticamente o que a automação criar')}
          <p class="ajuda">Desligado: as artes chegam em "Para aprovar" e você aprova a semana com um clique. Ligado: vão direto para o agendamento.</p></div>
        <div class="duas">
          <div class="campo"><label for="a-horizonte_dias">Preparar com quantos dias de antecedência</label><input type="text" inputmode="numeric" id="a-horizonte_dias" value="${esc(c.horizonte_dias)}"></div>
          <div class="campo"><label for="a-feriados_extras">Feriados extras <span class="ajuda">(um por linha: 05/12 feriado municipal, ou 20/11/2027)</span></label><textarea id="a-feriados_extras" style="min-height:80px">${esc(c.feriados_extras)}</textarea></div>
        </div>
        <div class="acoes"><button class="btn prim" id="salvar" type="button">Salvar automações</button><button class="btn" id="executar" type="button">Criar as próximas agora</button></div></div>
      <div class="cartao"><h2>Próximas publicações automáticas</h2>
        ${auto.plano.length ? auto.plano.map(p => `<div class="linha-polo secao" style="margin-top:10px;padding-top:10px"><div><strong>${dataBR(p.data_hora)}</strong> · ${esc(p.descricao)} <span class="meta">(${p.formatos.map(f => FORMATO[f]).join(' + ')})</span>${p.sem_curso ? ' <span class="selo s-erro">Sem curso ativo</span>' : ''}</div><span class="selo ${p.criada ? 's-publicada' : 's-rascunho'}">${p.criada ? 'Já criada' : 'Será criada'}</span></div>`).join('')
          : '<p class="vazio" style="padding:20px">Nada previsto no período.</p>'}
      </div>
    </div>`;
  const coletar = () => {
    const v = id => document.getElementById('a-' + id);
    const corpo = {};
    for (const k of ['boleto_ativo', 'arrasto_ativo', 'cursos_ativo', 'auto_aprovar']) corpo[k] = v(k).checked ? '1' : '0';
    for (const k of ['boleto_dia', 'boleto_dias_antes', 'boleto_hora', 'arrasto_dia', 'arrasto_dias_antes', 'arrasto_hora', 'cursos_hora', 'cursos_por_dia', 'cursos_modelo', 'horizonte_dias', 'feriados_extras']) corpo[k] = v(k).value.trim();
    corpo.cursos_dias = [...app.querySelectorAll('[data-dia]:checked')].map(x => x.value).join(',');
    for (const k of ['boleto_formatos', 'arrasto_formatos', 'cursos_formatos']) corpo[k] = [...app.querySelectorAll(`[data-fmt="${k}"]:checked`)].map(x => x.value).join(',');
    const dia = Number(corpo.boleto_dia);
    if (!(dia >= 1 && dia <= 31)) throw new Error('O dia do vencimento precisa ser entre 1 e 31.');
    const diaA = Number(corpo.arrasto_dia);
    if (!(diaA >= 1 && diaA <= 31)) throw new Error('O dia limite do desconto precisa ser entre 1 e 31.');
    return corpo;
  };
  document.getElementById('salvar').onclick = e => ocupado(e.currentTarget, async () => { await api('PUT', '/api/config', coletar()); aviso('Automações salvas.'); navegar(); });
  document.getElementById('executar').onclick = e => ocupado(e.currentTarget, async () => {
    await api('PUT', '/api/config', coletar());
    const r = await api('POST', '/api/automacao/executar');
    if (r.erros.length) aviso(`${r.criadas} criadas. Atenção: ${r.erros[0]}`, true);
    else aviso(r.criadas ? `${r.criadas} publicações criadas.` : 'Tudo em dia: nada novo para criar.');
    navegar();
  });
}

// ---------- Cursos ----------
async function cursos() {
  const lista = await api('GET', '/api/cursos');
  const vazio = { id: '', curso: '', nivel: 'GRADUAÇÃO', linha1: '', linha2: '', detalhe: '', icone: 'capelo', ativo: 1, preco_cheio: '', preco_desconto: '', desconto: '', primeira: '', link: '' };
  const semPreco = lista.filter(c => c.ativo && !c.preco_desconto).length;
  app.innerHTML = `
    <div class="linha-polo"><div><h1>Cursos</h1><p class="sub">Lista usada pelo rodízio automático. Só os cursos ativos entram na vez.${semPreco ? ` <strong>${semPreco} sem mensalidade</strong>: esses só saem com a arte do curso, sem oferta.` : ''}</p></div><button class="btn prim" id="novo" type="button">Adicionar curso</button></div>
    <div id="editor"></div>
    <div class="lista-polos">${lista.map(c => `
      <div class="cartao linha-polo"><div style="display:flex;gap:14px;align-items:center">
        <span class="ic-mini">${(S.icones[c.icone] || S.icones.capelo).svg}</span>
        <div><strong>${esc(c.curso)}</strong> ${c.ativo ? '' : '<span class="selo s-erro">Inativo</span>'}
        <div class="meta">${esc([c.nivel, c.linha1, c.linha2].filter(Boolean).join(' · ')) || 'Complete grau e modalidade antes de ativar'}</div>
        <div class="meta">${c.preco_desconto ? `Mensalidade ${esc(c.preco_desconto)}${c.desconto ? ' (' + esc(c.desconto) + ')' : ''}${c.primeira ? ' · 1ª ' + esc(c.primeira) : ''}` : '<span class="selo s-rascunho">Preço pendente</span>'}</div>
        ${c.campanha ? `<div class="meta"><span class="selo s-rascunho">${esc(c.campanha)}</span></div>` : ''}
        <div class="meta">${c.ultimo_post ? 'Último post: ' + dataBR(c.ultimo_post) : 'Ainda não publicado'}</div></div></div>
        <button class="btn" data-editar="${c.id}" type="button">Editar</button></div>`).join('')}</div>`;
  const editor = document.getElementById('editor');
  const abrir = c => {
    let icone = c.icone || 'capelo'; let mexeuIcone = Boolean(c.id);
    editor.innerHTML = `<div class="cartao" style="margin-bottom:16px"><h2>${c.id ? 'Editar ' + esc(c.curso) : 'Novo curso'}</h2>
      <div class="duas">
        <div class="campo"><label for="k-curso">Nome do curso</label><input type="text" id="k-curso" value="${esc(c.curso)}"></div>
        <div class="campo"><label for="k-nivel">Selo do topo</label><input type="text" id="k-nivel" value="${esc(c.nivel)}"></div>
        <div class="campo"><label for="k-linha1">Linha 1 (branca) <span class="ajuda">ex.: Licenciatura, Bacharelado, Tecnólogo</span></label><input type="text" id="k-linha1" value="${esc(c.linha1)}"></div>
        <div class="campo"><label for="k-linha2">Linha 2 (ciano) <span class="ajuda">ex.: Semipresencial, EAD</span></label><input type="text" id="k-linha2" value="${esc(c.linha2)}"></div>
        <div class="campo"><label for="k-detalhe">Detalhe <span class="ajuda">(opcional, ex.: Duração de 4 anos)</span></label><input type="text" id="k-detalhe" value="${esc(c.detalhe)}"></div>
        <div class="campo"><label for="k-campanha">Campanha <span class="ajuda">(ex.: Esquenta Black · Semanas 1 e 2; vazio = fora de campanha)</span></label><input type="text" id="k-campanha" list="k-campanhas" value="${esc(c.campanha || '')}"><datalist id="k-campanhas">${[...new Set(lista.map(x => x.campanha).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
      </div>
      <h2 style="margin-top:18px">Preço no polo <span class="ajuda">(usado na arte "Oferta do curso"; vazio = o curso não entra na oferta)</span></h2>
      <div class="duas">
        <div class="campo"><label for="k-primeira">1ª mensalidade <span class="ajuda">informe o valor vigente</span></label><input type="text" id="k-primeira" value="${esc(c.primeira || '')}"></div>
        <div class="campo"><label for="k-desconto">Desconto <span class="ajuda">informe a condição vigente</span></label><input type="text" id="k-desconto" value="${esc(c.desconto || '')}"></div>
        <div class="campo"><label for="k-preco_cheio">Mensalidade cheia <span class="ajuda">informe o valor vigente</span></label><input type="text" id="k-preco_cheio" value="${esc(c.preco_cheio || '')}"></div>
        <div class="campo"><label for="k-preco_desconto">Mensalidade com desconto <span class="ajuda">informe o valor vigente</span></label><input type="text" id="k-preco_desconto" value="${esc(c.preco_desconto || '')}"></div>
        <div class="campo"><label for="k-link">Página do curso <span class="ajuda">(para conferir o preço)</span></label><input type="text" id="k-link" value="${esc(c.link || '')}">${c.link ? ` <a href="${esc(c.link)}" target="_blank" rel="noopener" class="ajuda">abrir página</a>` : ''}</div>
      </div>
      <div class="campo"><label>Ícone da arte</label><div id="k-icones">${seletorIcone(icone, 'icone')}</div></div>
      <div class="campo chips"><label class="chip" style="display:inline-flex"><input type="checkbox" id="k-ativo" ${c.ativo ? 'checked' : ''}> Ativo no rodízio</label>
        <label class="chip" style="display:inline-flex"><input type="checkbox" id="k-em_propostas" ${c.em_propostas !== 0 ? 'checked' : ''}> Pode aparecer em propostas empresariais</label></div>
      <div class="acoes"><button class="btn prim" id="salvar" type="button">Salvar</button><button class="btn" id="cancelar" type="button">Cancelar</button>
        ${c.id ? '<button class="btn perigo" id="excluir" type="button">Excluir curso</button>' : ''}</div></div>`;
    const caixa = document.getElementById('k-icones');
    const ligar = () => ligarIcones(caixa.querySelector('.icones'), k => { icone = k; mexeuIcone = true; });
    ligar();
    // Curso novo: sugere o ícone pelo nome, até você escolher outro
    document.getElementById('k-curso').onchange = async e => {
      if (mexeuIcone) return;
      try { icone = (await api('GET', '/api/icones/sugerir?curso=' + encodeURIComponent(e.target.value))).icone; caixa.innerHTML = seletorIcone(icone, 'icone'); ligar(); } catch {}
    };
    document.getElementById('cancelar').onclick = () => (editor.innerHTML = '');
    const ex = document.getElementById('excluir');
    if (ex) ex.onclick = () => ocupado(ex, async () => { if (!confirm('Excluir o curso ' + c.curso + '?')) return; await api('DELETE', '/api/cursos/' + c.id); navegar(); });
    document.getElementById('salvar').onclick = e => ocupado(e.currentTarget, async () => {
      const v = k => document.getElementById('k-' + k).value.trim();
      await api(c.id ? 'PUT' : 'POST', '/api/cursos' + (c.id ? '/' + c.id : ''), { curso: v('curso'), nivel: v('nivel'), linha1: v('linha1'), linha2: v('linha2'), detalhe: v('detalhe'), icone, ativo: document.getElementById('k-ativo').checked,
        em_propostas: document.getElementById('k-em_propostas').checked, primeira: v('primeira'), desconto: v('desconto'), preco_cheio: v('preco_cheio'), preco_desconto: v('preco_desconto'), link: v('link'), campanha: v('campanha') });
      aviso('Curso salvo.'); navegar();
    });
    editor.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('novo').onclick = () => abrir(vazio);
  app.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => abrir(lista.find(c => String(c.id) === b.dataset.editar)));
}

// ---------- Tutoras ----------
async function tutoras() {
  const lista = await api('GET', '/api/tutoras');
  const polosAtivos = S.polos.filter(p => p.ativo);
  const avatar = t => t.foto ? `<img src="/fotos/${esc(t.foto)}" alt="" class="avatar">` : `<span class="avatar vazio">${esc((t.nome || '?').trim().charAt(0).toUpperCase())}</span>`;
  app.innerHTML = `
    <div class="linha-polo"><div><h1>Tutoras</h1><p class="sub">Cada tutora ganha artes com a foto, o nome e o WhatsApp dela. Use "Cartão da tutora" ou qualquer modelo com "Uma arte para cada tutora".</p></div>
      <div class="acoes"><a class="btn" href="#/nova">Gerar artes</a><button class="btn prim" id="nova-t" type="button">Adicionar tutora</button></div></div>
    <div id="editor"></div>
    ${polosAtivos.map(p => {
      const doPolo = lista.filter(t => t.polo_id === p.id);
      return `<h2 style="margin-top:22px">Polo ${esc(p.nome)} <span class="ajuda">(${doPolo.filter(t => t.ativo).length} ativas)</span></h2>
      <div class="lista-polos">${doPolo.map(t => `<div class="cartao linha-polo"><div style="display:flex;gap:14px;align-items:center">${avatar(t)}
        <div><strong>${esc(t.nome)}</strong> ${t.ativo ? '' : '<span class="selo s-erro">Inativa</span>'}<div class="meta">WhatsApp ${esc(t.whatsapp) || '<em>sem número</em>'} · ${t.foto ? 'com foto' : '<strong>sem foto</strong>'}</div></div></div>
        <button class="btn" data-editar="${t.id}" type="button">Editar</button></div>`).join('') || '<p class="meta">Nenhuma tutora cadastrada.</p>'}</div>`;
    }).join('')}`;
  const editor = document.getElementById('editor');
  const abrir = t => {
    let foto = t.foto || '';
    editor.innerHTML = `<div class="cartao" style="margin-bottom:16px"><h2>${t.id ? 'Editar ' + esc(t.nome) : 'Nova tutora'}</h2>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <div id="t-foto"></div>
          <label class="btn peq" for="t-up" style="cursor:pointer">Enviar foto</label><input type="file" id="t-up" accept="image/jpeg,image/png,image/webp" style="position:absolute;opacity:0;width:1px;height:1px">
          <span class="ajuda" style="max-width:180px;text-align:center">Foto de rosto, de preferência quadrada e com fundo limpo.</span>
        </div>
        <div style="flex:1;min-width:260px">
          <div class="campo"><label for="t-nome">Nome (como vai aparecer na arte)</label><input type="text" id="t-nome" value="${esc(t.nome || '')}"></div>
          <div class="duas">
            <div class="campo"><label for="t-whatsapp">WhatsApp</label><input type="text" id="t-whatsapp" placeholder="DDD e número" value="${esc(t.whatsapp || '')}"></div>
            <div class="campo"><label for="t-polo">Polo</label><select id="t-polo">${polosAtivos.map(p => `<option value="${p.id}" ${p.id === t.polo_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
          </div>
          <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="t-ativo" ${t.ativo !== 0 ? 'checked' : ''}> Ativa</label></div>
          <div class="acoes"><button class="btn prim" id="salvar" type="button">Salvar</button><button class="btn" id="cancelar" type="button">Cancelar</button></div>
        </div>
      </div></div>`;
    const caixa = document.getElementById('t-foto');
    const mostrar = () => caixa.innerHTML = foto ? `<img src="/fotos/${esc(foto)}" alt="Foto da tutora" class="avatar grande">` : '<span class="avatar grande vazio">sem foto</span>';
    mostrar();
    document.getElementById('t-up').onchange = e => {
      const arq = e.target.files[0]; if (!arq) return;
      if (arq.size > 12 * 1024 * 1024) return aviso('Foto grande demais (máx. 12 MB).', true);
      const r = new FileReader();
      r.onload = async () => { try { foto = (await api('POST', '/api/fotos', { base64: r.result })).foto; mostrar(); } catch (err) { aviso(err.message, true); } };
      r.readAsDataURL(arq);
    };
    document.getElementById('cancelar').onclick = () => (editor.innerHTML = '');
    document.getElementById('salvar').onclick = e => ocupado(e.currentTarget, async () => {
      const v = k => document.getElementById('t-' + k).value.trim();
      await api(t.id ? 'PUT' : 'POST', '/api/tutoras' + (t.id ? '/' + t.id : ''), { nome: v('nome'), whatsapp: v('whatsapp'), polo_id: Number(v('polo')), foto, ativo: document.getElementById('t-ativo').checked });
      aviso('Tutora salva.'); navegar();
    });
    editor.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('nova-t').onclick = () => abrir({ polo_id: polosAtivos[0]?.id, ativo: 1 });
  app.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => abrir(lista.find(t => String(t.id) === b.dataset.editar)));
}

// ---------- Polos ----------
async function polos() {
  const vazio = { id: '', nome: '', endereco: '', whatsapp_vendas: '', whatsapp_pedagogico: '', horario: '', instagram: '', ig_user_id: '', ativo: 1 };
  app.innerHTML = `
    <div class="linha-polo"><div><h1>Polos</h1><p class="sub">Os dados de cada polo entram automaticamente nas artes e nas legendas.</p></div><button class="btn prim" id="novo" type="button">Adicionar polo</button></div>
    <div id="editor"></div>
    <div class="lista-polos">${S.polos.map(p => `
      <div class="cartao linha-polo"><div><strong>Polo ${esc(p.nome)}</strong> ${p.ativo ? '' : '<span class="selo s-erro">Inativo</span>'}
        <div class="meta">${esc(p.endereco)} · Vendas ${esc(p.whatsapp_vendas)} · Pedagógico ${esc(p.whatsapp_pedagogico)} · ${esc(p.instagram)}</div>
        <div class="meta">${p.ig_user_id && p.tem_token ? 'Instagram conectado' : 'Instagram ainda não conectado'}</div></div>
        <button class="btn" data-editar="${p.id}" type="button">Editar</button></div>`).join('')}</div>`;
  const editor = document.getElementById('editor');
  const abrir = p => {
    editor.innerHTML = `<div class="cartao" style="margin-bottom:16px"><h2>${p.id ? 'Editar polo ' + esc(p.nome) : 'Novo polo'}</h2>
      <div class="duas">
        <div class="campo"><label for="p-nome">Nome (cidade do polo)</label><input type="text" id="p-nome" value="${esc(p.nome)}"></div>
        <div class="campo"><label for="p-instagram">@ do Instagram</label><input type="text" id="p-instagram" value="${esc(p.instagram)}"></div>
        <div class="campo"><label for="p-endereco">Endereço</label><input type="text" id="p-endereco" value="${esc(p.endereco)}"></div>
        <div class="campo"><label for="p-horario">Horário de funcionamento</label><input type="text" id="p-horario" value="${esc(p.horario)}"></div>
        <div class="campo"><label for="p-whatsapp_vendas">WhatsApp de vendas <span class="ajuda">(cursos e boletos)</span></label><input type="text" id="p-whatsapp_vendas" value="${esc(p.whatsapp_vendas)}"></div>
        <div class="campo"><label for="p-whatsapp_pedagogico">WhatsApp pedagógico <span class="ajuda">(provas)</span></label><input type="text" id="p-whatsapp_pedagogico" value="${esc(p.whatsapp_pedagogico)}"></div>
      </div>
      <div class="secao"><h2>Conexão com o Instagram <span class="ajuda">(preencher depois de criar o app na Meta)</span></h2><div class="duas">
        <div class="campo"><label for="p-ig_user_id">ID da conta do Instagram</label><input type="text" id="p-ig_user_id" value="${esc(p.ig_user_id)}"></div>
        <div class="campo"><label for="p-ig_token">Token de acesso ${p.tem_token ? '<span class="ajuda">(já salvo; preencha só para trocar)</span>' : ''}</label><input type="password" id="p-ig_token" autocomplete="off"></div>
      </div></div>
      <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="p-ativo" ${p.ativo ? 'checked' : ''}> Polo ativo</label></div>
      ${p.id ? '<div class="secao" style="margin-top:0"><button class="btn" id="testar-meta" type="button">Testar conexão com o Instagram</button><div id="resultado-meta" class="meta" style="margin-top:8px"></div></div>' : ''}
      <div class="acoes"><button class="btn prim" id="salvar" type="button">Salvar</button><button class="btn" id="cancelar" type="button">Cancelar</button></div></div>`;
    document.getElementById('cancelar').onclick = () => (editor.innerHTML = '');
    const tm = document.getElementById('testar-meta');
    if (tm) tm.onclick = () => ocupado(tm, async () => {
      const r = await api('POST', `/api/polos/${p.id}/testar-meta`);
      document.getElementById('resultado-meta').innerHTML = `Instagram: ${esc(r.instagram)}<br>Hospedagem (Supabase): ${esc(r.supabase)}<br><strong>${r.ok ? 'Tudo certo: as publicações aprovadas deste polo já saem sozinhas no horário.' : 'Ainda falta ajustar o item com erro (salve o polo antes de testar).'}</strong>`;
    });
    document.getElementById('salvar').onclick = e => ocupado(e.currentTarget, async () => {
      const v = k => document.getElementById('p-' + k).value.trim();
      const corpo = { nome: v('nome'), instagram: v('instagram'), endereco: v('endereco'), horario: v('horario'), whatsapp_vendas: v('whatsapp_vendas'), whatsapp_pedagogico: v('whatsapp_pedagogico'), ig_user_id: v('ig_user_id'), ig_token: v('ig_token'), ativo: document.getElementById('p-ativo').checked };
      await api(p.id ? 'PUT' : 'POST', '/api/polos' + (p.id ? '/' + p.id : ''), corpo);
      aviso('Polo salvo.'); navegar();
    });
    editor.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('novo').onclick = () => abrir(vazio);
  app.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => abrir(S.polos.find(p => String(p.id) === b.dataset.editar)));
}

// ---------- Tipos e legendas ----------
async function tipos() {
  app.innerHTML = `<h1>Tipos e legendas</h1>
    <p class="sub">Ajuste nomes, textos padrão, qual WhatsApp aparece e o modelo de legenda de cada tipo. O visual das artes vem dos templates.</p>
    <div class="grade">${[...S.tipos].sort((a, b) => (a.grupo === 'pedagogico') - (b.grupo === 'pedagogico')).map(t => `
      <div class="cartao" data-tipo="${t.id}">
        <div class="duas">
          <div class="campo"><label>Nome</label><input type="text" data-k="nome" value="${esc(t.nome)}"></div>
          <div class="campo"><label>Aba na Nova publicação</label><select data-k="grupo"><option value="comercial" ${t.grupo !== 'pedagogico' ? 'selected' : ''}>Comercial</option><option value="pedagogico" ${t.grupo === 'pedagogico' ? 'selected' : ''}>Pedagógico</option></select></div>
          <div class="campo"><label>WhatsApp usado</label><select data-k="contato"><option value="vendas" ${t.contato === 'vendas' ? 'selected' : ''}>Vendas</option><option value="pedagogico" ${t.contato === 'pedagogico' ? 'selected' : ''}>Pedagógico</option></select></div>
        </div>
        <div class="campo"><label>Descrição</label><input type="text" data-k="descricao" value="${esc(t.descricao)}"></div>
        ${t.id !== 'curso' ? `<div class="campo"><label>Ícone da arte</label>${seletorIcone(t.icone, 'icone')}</div>` : '<p class="ajuda">No curso, o ícone é escolhido em cada curso, na tela Cursos.</p>'}
        <details><summary>Textos padrão da arte</summary><div class="duas" style="margin-top:10px">
          ${t.campos.map(c => `<div class="campo"><label>${esc(c.chave)}</label><input type="text" data-c="${c.chave}" data-r="rotulo" value="${esc(c.rotulo)}" aria-label="Rótulo de ${esc(c.chave)}" style="margin-bottom:6px">${c.tipo === 'date' ? '<span class="ajuda">Campo de data</span>' : `<input type="text" data-c="${c.chave}" data-r="padrao" value="${esc(c.padrao || '')}" aria-label="Texto padrão de ${esc(c.chave)}">`}</div>`).join('')}
        </div></details>
        <div class="campo" style="margin-top:12px"><label>Modelo de legenda</label><textarea data-k="legenda_padrao">${esc(t.legenda_padrao)}</textarea></div>
        <div class="acoes"><label class="chip"><input type="checkbox" data-k="ativo" ${t.ativo ? 'checked' : ''}> Ativo</label>
          ${t.campos.some(c => c.tipo === 'date') ? `<label class="chip"><input type="checkbox" data-k="data_completa" ${t.data_completa ? 'checked' : ''}> Mostrar o ano nas datas</label>` : ''}<button class="btn prim" data-salvar type="button">Salvar</button></div>
      </div>`).join('')}</div>`;
  app.querySelectorAll('.icones').forEach(g => ligarIcones(g));
  app.querySelectorAll('[data-salvar]').forEach(b => b.onclick = () => ocupado(b, async () => {
    const card = b.closest('[data-tipo]'); const corpo = {};
    card.querySelectorAll('[data-k]').forEach(i => (corpo[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value));
    const campos = {};
    card.querySelectorAll('[data-c]').forEach(i => { campos[i.dataset.c] = campos[i.dataset.c] || { chave: i.dataset.c }; campos[i.dataset.c][i.dataset.r] = i.value; });
    corpo.campos = Object.values(campos);
    const grade = card.querySelector('.icones'); if (grade) corpo.icone = iconeEscolhido(grade);
    await api('PUT', '/api/tipos/' + card.dataset.tipo, corpo); aviso('Tipo salvo.');
  }));
}

// ---------- Configurações ----------
async function config() {
  const [c, rede] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/rede')]);
  let canais = []; try { canais = await api('GET', '/api/whatsapp/canais'); } catch {}
  const campo = (k, rot, ajuda = '', tipo = 'text') => `<div class="campo"><label for="cf-${k}">${rot} ${ajuda ? `<span class="ajuda">${ajuda}</span>` : ''}</label><input type="${tipo}" id="cf-${k}" value="${esc(c[k])}" autocomplete="off"></div>`;
  app.innerHTML = `<h1>Configurações</h1><p class="sub">Ajustes do sistema neste computador.</p>
    <div class="grade">
      <div class="cartao"><h2>Geração das artes</h2>
        <p class="meta">Navegador encontrado: ${S.estado.navegador ? esc(S.estado.navegador) : '<strong>nenhum</strong>'}</p>
        ${campo('navegador', 'Caminho do navegador', '(deixe em branco para detectar o Edge ou o Chrome sozinho)')}
        <div class="acoes"><button class="btn" id="teste" type="button">Testar geração de arte</button></div><div id="teste-res" style="margin-top:12px"></div></div>
      <div class="cartao"><h2>Backup</h2>
        ${campo('backup_pasta', 'Pasta de backup', '(ex.: C:\\Users\\Gabriel\\OneDrive\\Backup Automatizador)')}
        <p class="meta">O sistema copia o banco para essa pasta ao abrir e a cada 6 horas, e guarda os 14 backups mais recentes.</p>
        <button class="btn" id="backup" type="button">Fazer backup agora</button></div>
      <div class="cartao"><h2>Publicação automática (para depois)</h2>
        <p class="meta">A Meta busca as artes por um link público. Ao publicar, o sistema envia a arte para um armazenamento no Supabase. Preencha junto com a conexão do Instagram de cada polo.</p>
        <div class="duas">${campo('supabase_url', 'URL do projeto Supabase')}${campo('supabase_key', 'Chave service_role do Supabase', '', 'password')}${campo('supabase_bucket', 'Bucket público')}${campo('meta_versao', 'Versão da API da Meta')}</div></div>
      <div class="cartao"><h2>Publicação agendada no Canal do WhatsApp</h2>
        <p class="meta">O Balbino Chat precisa estar conectado ao WhatsApp e a conta precisa poder publicar no canal. Configure BALBINO_CHAT_TOKEN e BALBINO_CHAT_URL no arquivo .env deste sistema.</p>
        <div class="campo"><label for="cf-whatsapp_channel_id">Canal de destino</label><select id="cf-whatsapp_channel_id"><option value="">Selecione um canal sincronizado no Balbino Chat</option>${canais.map(x=>`<option value="${esc(x.id)}" ${String(c.whatsapp_channel_id||'')===String(x.id)?'selected':''}>${esc(x.name)}${x.connected?' · conectado':' · desconectado'}${x.role?' · '+esc(x.role):''}</option>`).join('')}${c.whatsapp_channel_id&&!canais.some(x=>String(x.id)===String(c.whatsapp_channel_id))?`<option value="${esc(c.whatsapp_channel_id)}" selected>Canal configurado (${esc(c.whatsapp_channel_id)})</option>`:''}</select></div>
        <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="cf-whatsapp_auto_publicar" ${c.whatsapp_auto_publicar==='1'?'checked':''}> Publicar automaticamente no horário agendado</label></div>
        <p class="meta">Somente artes aprovadas e agendadas depois de ativar entram na fila automática. Publicações antigas não serão disparadas ao ligar a opção.</p></div>
      <div class="cartao"><h2>Sistema</h2>${campo('porta', 'Porta local', '(muda o endereço; reinicie o sistema depois)')}</div>
      <div class="cartao"><h2>Acesso pela rede</h2>
        ${rede.local ? `<p class="meta">Libera o sistema para outros computadores da mesma rede (Wi-Fi ou cabo do polo). Quem entra por outro computador precisa da senha; neste computador não pede.</p>
        <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="rede-ativa" ${rede.ativa ? 'checked' : ''}> Permitir acesso de outros computadores</label></div>
        <div class="campo" style="max-width:360px"><label for="rede-senha">${rede.tem_senha ? 'Nova senha <span class="ajuda">(deixe em branco para manter a atual)</span>' : 'Senha de acesso <span class="ajuda">(mínimo de 6 caracteres)</span>'}</label><input type="password" id="rede-senha" autocomplete="new-password"></div>
        ${rede.ativa && rede.enderecos.length ? `<p class="meta">Nos outros computadores, abra no navegador:</p><div class="chips">${rede.enderecos.map(e => `<span class="chip"><strong>${esc(e)}</strong></span>`).join('')}</div>` : ''}
        <p class="ajuda" style="margin-top:10px">Na primeira vez, o Windows pergunta se permite o acesso do Node.js: marque <strong>Redes privadas</strong> e clique em Permitir. Este computador precisa ficar ligado com a janela preta aberta.</p>
        <div class="acoes" style="margin-top:10px"><button class="btn" id="rede-salvar" type="button">Salvar acesso pela rede</button></div>`
        : `<p class="meta">Você está usando o sistema por outro computador da rede. As configurações de acesso só podem ser mudadas no computador principal.</p><div class="acoes"><button class="btn" id="rede-sair" type="button">Sair deste computador</button></div>`}</div>
      <div><button class="btn prim" id="salvar" type="button">Salvar configurações</button></div>
    </div>`;
  document.getElementById('salvar').onclick = e => ocupado(e.currentTarget, async () => {
    const corpo = {}; app.querySelectorAll('[id^=cf-]').forEach(i => (corpo[i.id.slice(3)] = i.value));
    corpo.whatsapp_auto_publicar = document.getElementById('cf-whatsapp_auto_publicar').checked ? '1' : '0';
    await api('PUT', '/api/config', corpo); aviso('Configurações salvas.'); navegar();
  });
  const rs = document.getElementById('rede-salvar');
  if (rs) rs.onclick = e => ocupado(e.currentTarget, async () => {
    const r = await api('PUT', '/api/rede', { ativa: document.getElementById('rede-ativa').checked, senha: document.getElementById('rede-senha').value });
    aviso(r.enderecos.length ? 'Acesso pela rede liberado: ' + r.enderecos.join('  ') : 'Acesso pela rede desligado.');
    setTimeout(navegar, 900);
  });
  const sair = document.getElementById('rede-sair');
  if (sair) sair.onclick = async () => { await api('POST', '/api/sair'); location.reload(); };
  document.getElementById('backup').onclick = e => ocupado(e.currentTarget, async () => { const r = await api('POST', '/api/backup'); aviso('Backup salvo em ' + r.arquivo); });
  document.getElementById('teste').onclick = e => ocupado(e.currentTarget, async () => {
    const r = await api('POST', '/api/teste-navegador');
    document.getElementById('teste-res').innerHTML = `<p class="meta">Funcionou! Arte de teste:</p><img src="/artes/${esc(r.arquivo)}?v=${Date.now()}" alt="Arte de teste" style="max-width:260px;border-radius:10px">`;
  });
}

// ---------- Empresas e propostas empresariais ----------
async function empresas() {
  const aba = new URLSearchParams(location.hash.split('?')[1] || '').get('aba') || 'propostas';
  const [lista, segs, tuts, cursosAll, cfg] = await Promise.all([api('GET', '/api/empresas'), api('GET', '/api/segmentos'), api('GET', '/api/tutoras'), api('GET', '/api/cursos'), api('GET', '/api/config')]);
  const polosAtivos = S.polos.filter(p => p.ativo);
  const tutsAtivas = tuts.filter(t => t.ativo);
  const ABAS = [['propostas', 'Gerar proposta'], ['lista', `Empresas (${lista.filter(e => e.ativo).length})`], ['segmentos', 'Segmentos e cursos'], ['textos', 'Textos da arte']];
  app.innerHTML = `<h1>Empresas e propostas</h1>
    <p class="sub">Arte horizontal (1920×1080) para apresentar cursos a uma empresa, com a foto e o WhatsApp da consultora. Ela não é publicada no Instagram: baixe e envie.</p>
    <div class="abas">${ABAS.map(([k, n]) => `<button type="button" data-aba="${k}" class="${k === aba ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    <div id="conteudo-emp"></div>`;
  app.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => (location.hash = '#/empresas?aba=' + b.dataset.aba));
  const alvo = document.getElementById('conteudo-emp');
  const elegiveis = cursosAll.filter(c => c.ativo && c.em_propostas !== 0);
  const rotCurso = c => esc(c.curso) + (c.linha1 ? ` <span class="meta">· ${esc(c.linha1)}${c.linha2 ? ' · ' + esc(c.linha2) : ''}</span>` : '');
  const nomeEmp = e => e.nome_fantasia || e.nome;

  if (aba === 'lista') return telaEmpresas();
  if (aba === 'segmentos') return telaSegmentos();
  if (aba === 'textos') return telaTextos();
  return telaProposta();

  // ----- Gerar proposta -----
  async function telaProposta() {
    const ativas = lista.filter(e => e.ativo);
    if (!ativas.length) { alvo.innerHTML = `<div class="cartao vazio" style="padding:30px">Cadastre a primeira empresa na aba <a href="#/empresas?aba=lista">Empresas</a>.</div>`; return; }
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const st = { empresa: Number(qs.get('empresa')) || ativas[0].id, dados: null, cursos: [], tutora: null, subtitulo: '', faixa: true };
    alvo.innerHTML = `<div class="nova" style="grid-template-columns:minmax(0,1fr) minmax(0,1.25fr)">
      <div><div class="cartao" id="pp-form"></div><div class="cartao" id="pp-cursos" style="margin-top:16px"></div>
        <div class="cartao" style="margin-top:16px"><h2>Para várias empresas</h2>
          <p class="meta">Gera uma arte para cada empresa ativa, usando a seleção já salva de cada uma ou, se ainda não houver, os cursos sugeridos pelo segmento.</p>
          <div class="acoes" style="margin-top:10px"><select id="lote-seg" style="width:auto"><option value="">Todas as empresas</option>${segs.filter(s => s.ativo).map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select>
          <button class="btn" id="lote" type="button">Gerar e baixar (.zip)</button></div><div id="lote-res" class="meta" style="margin-top:8px"></div></div></div>
      <div class="previa" style="position:sticky;top:12px"><div class="cartao"><h2>Prévia</h2>
        <div class="moldura" id="pp-moldura"><iframe id="pp-pv" title="Prévia da proposta" scrolling="no"></iframe></div>
        <div id="pp-msg" class="meta" style="margin-top:8px"></div>
        <div class="acoes" style="margin-top:12px"><button class="btn prim" id="pp-gerar" type="button">Gerar PNG</button><a class="btn" id="pp-baixar" style="display:none">Baixar imagem</a></div></div></div>
    </div>`;
    const form = document.getElementById('pp-form'), boxCursos = document.getElementById('pp-cursos');
    async function carregar() {
      st.dados = await api('GET', '/api/propostas/sugestao?empresa=' + st.empresa);
      st.cursos = [...st.dados.escolhidos]; st.tutora = st.dados.tutora_id; st.subtitulo = st.dados.subtitulo; st.faixa = st.dados.mostrar_faixa;
      desenhar(); previa();
    }
    function desenhar() {
      const e = st.dados.empresa;
      const tutsPolo = tutsAtivas.filter(t => t.polo_id === e.polo_id);
      const outras = tutsAtivas.filter(t => t.polo_id !== e.polo_id);
      form.innerHTML = `<div class="duas">
        <div class="campo"><label for="pp-emp">Empresa</label><select id="pp-emp">${ativas.map(x => `<option value="${x.id}" ${x.id === st.empresa ? 'selected' : ''}>${esc(nomeEmp(x))}</option>`).join('')}</select></div>
        <div class="campo"><label>Segmento e polo</label><div style="padding-top:8px">${esc(e.segmento_nome || 'Sem segmento')} · Polo ${esc(e.polo_nome || '?')}</div></div>
        <div class="campo"><label for="pp-tut">Consultora</label><select id="pp-tut"><option value="">Escolha…</option>
          ${tutsPolo.map(t => `<option value="${t.id}" ${t.id === st.tutora ? 'selected' : ''}>${esc(t.nome)}${t.id === e.tutora_id ? ' (responsável)' : ''}${t.foto ? '' : ' · sem foto'}</option>`).join('')}
          ${outras.length ? `<optgroup label="Outros polos">${outras.map(t => `<option value="${t.id}" ${t.id === st.tutora ? 'selected' : ''}>${esc(t.nome)} · ${esc(t.polo_nome || '')}</option>`).join('')}</optgroup>` : ''}</select></div>
        <div class="campo"><label class="chip" style="display:inline-flex;margin-top:26px"><input type="checkbox" id="pp-faixa" ${st.faixa ? 'checked' : ''}> Mostrar o nome da empresa no topo</label></div>
        <div class="campo" style="grid-column:1/-1"><label for="pp-sub">Subtítulo</label><input type="text" id="pp-sub" value="${esc(st.subtitulo)}"></div>
      </div>${tutsAtivas.length ? '' : '<p class="erro-txt">Cadastre a consultora em <a href="#/tutoras">Tutoras</a> (nome, WhatsApp, polo e foto).</p>'}`;
      document.getElementById('pp-emp').onchange = ev => { st.empresa = Number(ev.target.value); carregar(); };
      document.getElementById('pp-tut').onchange = ev => { st.tutora = Number(ev.target.value) || null; previa(); };
      document.getElementById('pp-faixa').onchange = ev => { st.faixa = ev.target.checked; previa(); };
      document.getElementById('pp-sub').oninput = ev => { st.subtitulo = ev.target.value; previaDepois(); };
      desenharCursos();
    }
    function desenharCursos() {
      const porId = new Map(elegiveis.map(c => [c.id, c]));
      const sugIds = new Set(st.dados.sugeridos.map(c => c.id));
      const fora = elegiveis.filter(c => !st.cursos.includes(c.id));
      const sugFora = fora.filter(c => sugIds.has(c.id));
      boxCursos.innerHTML = `<h2>Cursos na arte <span class="ajuda">(${st.cursos.length} de 3 a 6)</span></h2>
        ${st.dados.sem_associacao ? `<p class="meta" style="margin-bottom:10px">Este segmento ainda não tem cursos ligados. Escolha os cursos abaixo ou ligue em <a href="#/empresas?aba=segmentos">Segmentos e cursos</a>.</p>` : ''}
        ${st.cursos.map((id, i) => { const c = porId.get(id); return c ? `<div class="linha-curso"><span class="ordem">${i + 1}</span><span style="flex:1">${rotCurso(c)}${sugIds.has(id) ? ' <span class="selo s-rascunho">sugerido</span>' : ''}</span>
          <button class="btn mini" data-sobe="${i}" type="button" ${i ? '' : 'disabled'} aria-label="Subir">↑</button><button class="btn mini" data-desce="${i}" type="button" ${i < st.cursos.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button><button class="btn mini" data-tira="${i}" type="button">Remover</button></div>` : ''; }).join('')}
        ${sugFora.length ? `<p class="meta" style="margin:12px 0 6px">Outros sugeridos para o segmento:</p><div class="chips">${sugFora.map(c => `<button class="chip" type="button" data-poe="${c.id}" ${st.cursos.length >= 6 ? 'disabled' : ''}>+ ${esc(c.curso)}${c.linha1 ? ' · ' + esc(c.linha1) : ''}</button>`).join('')}</div>` : ''}
        <div class="campo" style="margin-top:12px"><label for="pp-add">Adicionar outro curso do catálogo</label><select id="pp-add" ${st.cursos.length >= 6 ? 'disabled' : ''}><option value="">Escolha…</option>${fora.filter(c => !sugIds.has(c.id)).map(c => `<option value="${c.id}">${esc(c.curso)}${c.linha1 ? ' · ' + esc(c.linha1) : ''}</option>`).join('')}</select></div>`;
      const mexer = fn => { fn(); desenharCursos(); previa(); };
      boxCursos.querySelectorAll('[data-sobe]').forEach(b => b.onclick = () => mexer(() => { const i = +b.dataset.sobe; [st.cursos[i - 1], st.cursos[i]] = [st.cursos[i], st.cursos[i - 1]]; }));
      boxCursos.querySelectorAll('[data-desce]').forEach(b => b.onclick = () => mexer(() => { const i = +b.dataset.desce; [st.cursos[i + 1], st.cursos[i]] = [st.cursos[i], st.cursos[i + 1]]; }));
      boxCursos.querySelectorAll('[data-tira]').forEach(b => b.onclick = () => mexer(() => st.cursos.splice(+b.dataset.tira, 1)));
      boxCursos.querySelectorAll('[data-poe]').forEach(b => b.onclick = () => mexer(() => st.cursos.push(Number(b.dataset.poe))));
      document.getElementById('pp-add').onchange = ev => { if (ev.target.value) mexer(() => st.cursos.push(Number(ev.target.value))); };
    }
    let tPrev;
    const previaDepois = () => { clearTimeout(tPrev); tPrev = setTimeout(previa, 350); };
    const pedido = () => ({ empresa_id: st.empresa, tutora_id: st.tutora, cursos: st.cursos, subtitulo: st.subtitulo, mostrar_faixa: st.faixa });
    async function previa() {
      const msg = document.getElementById('pp-msg'), mold = document.getElementById('pp-moldura'), ifr = document.getElementById('pp-pv');
      document.getElementById('pp-baixar').style.display = 'none';
      const tut = tutsAtivas.find(t => t.id === st.tutora);
      try {
        const pv = await api('POST', '/api/propostas/previa', pedido());
        const escala = mold.clientWidth / pv.w;
        ifr.style.width = pv.w + 'px'; ifr.style.height = pv.h + 'px'; ifr.style.transform = `scale(${escala})`;
        mold.style.height = Math.round(pv.h * escala) + 'px'; ifr.srcdoc = pv.html;
        msg.innerHTML = tut && !tut.foto ? 'Esta consultora ainda não tem foto: a arte usa um ícone no lugar. Envie a foto em <a href="#/tutoras">Tutoras</a>.' : '';
        msg.className = 'meta';
      } catch (e) { msg.textContent = e.message; msg.className = 'erro-txt'; }
    }
    document.getElementById('pp-gerar').onclick = ev => ocupado(ev.currentTarget, async () => {
      const r = await api('POST', '/api/propostas/gerar', pedido());
      const a = document.getElementById('pp-baixar'); a.href = '/artes/' + encodeURIComponent(r.arquivo) + '?baixar=1&v=' + Date.now(); a.style.display = '';
      aviso('Arte gerada. A seleção de cursos ficou salva para esta empresa.');
    });
    document.getElementById('lote').onclick = ev => ocupado(ev.currentTarget, async () => {
      const r = await api('POST', '/api/propostas/lote', { segmento_id: Number(document.getElementById('lote-seg').value) || null });
      document.getElementById('lote-res').innerHTML = `${r.feitas.length} arte(s) gerada(s).` + (r.puladas.length ? `<br>Ficaram de fora:<br>${r.puladas.map(esc).join('<br>')}` : '');
      if (r.feitas.length) location.href = '/api/propostas/zip?empresas=' + r.feitas.join(',');
    });
    carregar();
  }

  // ----- Cadastro de empresas -----
  function telaEmpresas() {
    const vazio = { id: '', nome: '', nome_fantasia: '', segmento_id: '', cidade: '', polo_id: polosAtivos[0]?.id || '', tutora_id: '', contato_nome: '', contato_whatsapp: '', contato_email: '', observacoes: '', ativo: 1 };
    alvo.innerHTML = `<div class="linha-polo" style="margin-bottom:12px"><p class="meta">Os contatos ficam só neste computador.</p><button class="btn prim" id="nova-emp" type="button">Adicionar empresa</button></div>
      <div id="ed-emp"></div>
      <div class="lista-polos">${lista.map(e => `<div class="cartao linha-polo"><div><strong>${esc(nomeEmp(e))}</strong> ${e.ativo ? '' : '<span class="selo s-erro">Inativa</span>'}
        <div class="meta">${esc([e.segmento_nome, e.cidade, e.polo_nome ? 'Polo ' + e.polo_nome : ''].filter(Boolean).join(' · '))}</div>
        <div class="meta">Consultora: ${esc(e.tutora_nome || 'não definida')}${e.gerado_em ? ' · Proposta gerada em ' + dataBR(e.gerado_em.replace(' ', 'T')) : ''}</div></div>
        <div class="acoes">${e.ativo ? `<a class="btn" href="#/empresas?aba=propostas&empresa=${e.id}">Proposta</a>` : ''}<button class="btn" data-ed="${e.id}" type="button">Editar</button></div></div>`).join('') || '<p class="vazio">Nenhuma empresa cadastrada.</p>'}</div>`;
    const ed = document.getElementById('ed-emp');
    const abrir = e => {
      const tutOpts = pid => tutsAtivas.filter(t => t.polo_id === Number(pid)).map(t => `<option value="${t.id}" ${t.id === e.tutora_id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('');
      ed.innerHTML = `<div class="cartao" style="margin-bottom:16px"><h2>${e.id ? 'Editar ' + esc(nomeEmp(e)) : 'Nova empresa'}</h2><div class="duas">
        <div class="campo"><label for="e-nome">Nome da empresa (razão social)</label><input type="text" id="e-nome" value="${esc(e.nome)}"></div>
        <div class="campo"><label for="e-nome_fantasia">Nome fantasia <span class="ajuda">(é o que aparece na arte)</span></label><input type="text" id="e-nome_fantasia" value="${esc(e.nome_fantasia)}"></div>
        <div class="campo"><label for="e-segmento_id">Segmento</label><select id="e-segmento_id"><option value="">Escolha…</option>${segs.filter(s => s.ativo || s.id === e.segmento_id).map(s => `<option value="${s.id}" ${s.id === e.segmento_id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="e-cidade">Cidade</label><input type="text" id="e-cidade" value="${esc(e.cidade)}"></div>
        <div class="campo"><label for="e-polo_id">Polo responsável</label><select id="e-polo_id">${polosAtivos.map(p => `<option value="${p.id}" ${p.id === Number(e.polo_id) ? 'selected' : ''}>Polo ${esc(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="e-tutora_id">Consultora responsável</label><select id="e-tutora_id"><option value="">Nenhuma ainda</option>${tutOpts(e.polo_id)}</select></div>
        <div class="campo"><label for="e-contato_nome">Contato na empresa <span class="ajuda">(opcional)</span></label><input type="text" id="e-contato_nome" value="${esc(e.contato_nome)}"></div>
        <div class="campo"><label for="e-contato_whatsapp">WhatsApp do contato <span class="ajuda">(opcional)</span></label><input type="text" id="e-contato_whatsapp" value="${esc(e.contato_whatsapp)}"></div>
        <div class="campo"><label for="e-contato_email">E-mail do contato <span class="ajuda">(opcional)</span></label><input type="email" id="e-contato_email" value="${esc(e.contato_email)}"></div>
      </div>
      <div class="campo"><label for="e-observacoes">Observações internas <span class="ajuda">(não aparecem na arte)</span></label><textarea id="e-observacoes" style="min-height:70px">${esc(e.observacoes)}</textarea></div>
      <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="e-ativo" ${e.ativo ? 'checked' : ''}> Empresa ativa</label></div>
      <div class="acoes"><button class="btn prim" id="e-salvar" type="button">Salvar</button><button class="btn" id="e-cancelar" type="button">Cancelar</button></div></div>`;
      document.getElementById('e-polo_id').onchange = ev => { document.getElementById('e-tutora_id').innerHTML = '<option value="">Nenhuma ainda</option>' + tutOpts(ev.target.value); };
      document.getElementById('e-cancelar').onclick = () => (ed.innerHTML = '');
      document.getElementById('e-salvar').onclick = ev => ocupado(ev.currentTarget, async () => {
        const v = k => document.getElementById('e-' + k).value.trim();
        const corpo = { nome: v('nome'), nome_fantasia: v('nome_fantasia'), segmento_id: Number(v('segmento_id')) || null, cidade: v('cidade'), polo_id: Number(v('polo_id')), tutora_id: Number(v('tutora_id')) || null,
          contato_nome: v('contato_nome'), contato_whatsapp: v('contato_whatsapp'), contato_email: v('contato_email'), observacoes: v('observacoes'), ativo: document.getElementById('e-ativo').checked };
        await api(e.id ? 'PUT' : 'POST', '/api/empresas' + (e.id ? '/' + e.id : ''), corpo);
        aviso('Empresa salva.'); navegar();
      });
      ed.scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('nova-emp').onclick = () => abrir(vazio);
    alvo.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => abrir(lista.find(e => String(e.id) === b.dataset.ed)));
  }

  // ----- Segmentos e a ligação com os cursos -----
  function telaSegmentos() {
    const porId = new Map(cursosAll.map(c => [c.id, c]));
    alvo.innerHTML = `<div class="linha-polo" style="margin-bottom:12px"><p class="meta">Cada segmento lista os cursos sugeridos, em ordem de prioridade. Só aparecem nas propostas cursos ativos e marcados "Pode aparecer em propostas" na tela <a href="#/cursos">Cursos</a>.</p><button class="btn prim" id="novo-seg" type="button">Adicionar segmento</button></div>
      <div id="ed-seg"></div>
      <div class="lista-polos">${segs.map(s => `<div class="cartao linha-polo"><div><strong>${esc(s.nome)}</strong> ${s.ativo ? '' : '<span class="selo s-erro">Inativo</span>'}
        <div class="meta">${s.cursos.length ? s.cursos.map(x => porId.get(x.curso_id)).filter(Boolean).map(c => esc(c.curso)).join(', ') : '<em>Sem cursos ligados: a proposta pede escolha manual</em>'}</div>
        <div class="meta">${s.qtd_empresas} empresa(s)</div></div><button class="btn" data-seg="${s.id}" type="button">Editar</button></div>`).join('')}</div>`;
    const ed = document.getElementById('ed-seg');
    const abrir = s => {
      let sel = s.cursos.map(x => x.curso_id).filter(id => porId.has(id));
      const desenhar = () => {
        const fora = cursosAll.filter(c => !sel.includes(c.id));
        ed.innerHTML = `<div class="cartao" style="margin-bottom:16px"><h2>${s.id ? 'Editar ' + esc(s.nome) : 'Novo segmento'}</h2><div class="duas">
          <div class="campo"><label for="s-nome">Nome</label><input type="text" id="s-nome" value="${esc(s.nome)}"></div>
          <div class="campo"><label for="s-sub">Subtítulo padrão da arte</label><input type="text" id="s-sub" value="${esc(s.subtitulo)}"></div></div>
          <h2 style="margin-top:8px">Cursos sugeridos <span class="ajuda">(a ordem é a prioridade; os 4 primeiros entram na proposta)</span></h2>
          ${sel.map((id, i) => { const c = porId.get(id); return `<div class="linha-curso"><span class="ordem">${i + 1}</span><span style="flex:1">${rotCurso(c)}${c.ativo && c.em_propostas !== 0 ? '' : ' <span class="selo s-erro">fora das propostas</span>'}</span>
            <button class="btn mini" data-s-sobe="${i}" type="button" ${i ? '' : 'disabled'} aria-label="Subir">↑</button><button class="btn mini" data-s-desce="${i}" type="button" ${i < sel.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button><button class="btn mini" data-s-tira="${i}" type="button">Remover</button></div>`; }).join('') || '<p class="meta">Nenhum curso ligado.</p>'}
          <div class="campo" style="margin-top:10px"><label for="s-add">Ligar outro curso</label><select id="s-add"><option value="">Escolha…</option>${fora.map(c => `<option value="${c.id}">${esc(c.curso)}${c.linha1 ? ' · ' + esc(c.linha1) : ''}</option>`).join('')}</select></div>
          <div class="campo"><label class="chip" style="display:inline-flex"><input type="checkbox" id="s-ativo" ${s.ativo ? 'checked' : ''}> Segmento ativo</label></div>
          <div class="acoes"><button class="btn prim" id="s-salvar" type="button">Salvar</button><button class="btn" id="s-cancelar" type="button">Cancelar</button></div></div>`;
        const nome = document.getElementById('s-nome'), sub = document.getElementById('s-sub');
        const guardar = () => { s.nome = nome.value; s.subtitulo = sub.value; s.ativo = document.getElementById('s-ativo').checked ? 1 : 0; };
        const mexer = fn => { guardar(); fn(); desenhar(); };
        ed.querySelectorAll('[data-s-sobe]').forEach(b => b.onclick = () => mexer(() => { const i = +b.dataset.sSobe; [sel[i - 1], sel[i]] = [sel[i], sel[i - 1]]; }));
        ed.querySelectorAll('[data-s-desce]').forEach(b => b.onclick = () => mexer(() => { const i = +b.dataset.sDesce; [sel[i + 1], sel[i]] = [sel[i], sel[i + 1]]; }));
        ed.querySelectorAll('[data-s-tira]').forEach(b => b.onclick = () => mexer(() => sel.splice(+b.dataset.sTira, 1)));
        document.getElementById('s-add').onchange = ev => { if (ev.target.value) mexer(() => sel.push(Number(ev.target.value))); };
        document.getElementById('s-cancelar').onclick = () => (ed.innerHTML = '');
        document.getElementById('s-salvar').onclick = ev => ocupado(ev.currentTarget, async () => {
          guardar();
          await api(s.id ? 'PUT' : 'POST', '/api/segmentos' + (s.id ? '/' + s.id : ''), { nome: s.nome, subtitulo: s.subtitulo, ativo: Boolean(s.ativo), cursos: sel });
          aviso('Segmento salvo.'); navegar();
        });
      };
      desenhar(); ed.scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('novo-seg').onclick = () => abrir({ id: '', nome: '', subtitulo: '', ativo: 1, cursos: [] });
    alvo.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => abrir(segs.find(s => String(s.id) === b.dataset.seg)));
  }

  // ----- Textos fixos da arte -----
  function telaTextos() {
    const campos = [['proposta_chamada', 'Chamada do lado esquerdo (use *texto* para destacar)'], ['proposta_cargo', 'Cargo da consultora'], ['proposta_titulo', 'Título do lado direito'],
      ['proposta_faixa', 'Faixa do topo ({empresa} vira o nome fantasia; vazio = sem faixa)'], ['proposta_whats_rotulo', 'Texto acima do WhatsApp'], ['proposta_rodape', 'Rodapé (esquerda)'], ['proposta_site', 'Rodapé (direita)']];
    alvo.innerHTML = `<div class="cartao"><p class="meta" style="margin-bottom:12px">Valem para todas as propostas. O subtítulo de cada arte vem do segmento e pode ser trocado na hora de gerar.</p><div class="duas">
      ${campos.map(([k, r]) => `<div class="campo"><label for="t-${k}">${esc(r)}</label><input type="text" id="t-${k}" value="${esc(cfg[k] || '')}"></div>`).join('')}</div>
      <div class="acoes"><button class="btn prim" id="t-salvar" type="button">Salvar textos</button></div></div>`;
    document.getElementById('t-salvar').onclick = ev => ocupado(ev.currentTarget, async () => {
      const corpo = {}; for (const [k] of campos) corpo[k] = document.getElementById('t-' + k).value;
      await api('PUT', '/api/config', corpo); aviso('Textos salvos.');
    });
  }
}
