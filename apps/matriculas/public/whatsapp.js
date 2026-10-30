'use strict';
/* Leitor das mensagens de matrícula postadas no WhatsApp.
   Aceita: texto copiado do WhatsApp Web (com ou sem o cabeçalho "[18:27, 26/10/2026] Fulano:"),
           conversa exportada do Android ("26/10/2026 18:27 - Fulano: ...") e do iPhone ("[26/10/2026, 18:27:05] Fulano: ...").
   Devolve uma lista de matrículas encontradas, já tentando casar polo, tutor, curso→produto e origem com os cadastros. */
(function (raiz) {
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const limpo = (t) => norm(t).replace(/[^a-z0-9]+/g, ' ').trim();
  const semEmoji = (t) => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B50}\u{2764}]/gu, '').replace(/[*_~]/g, '').trim();

  function dataISO(d, m, a) {
    a = String(a); if (a.length === 2) a = '20' + a;
    return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function valorBR(t) {
    if (t == null) return null;
    let v = String(t).replace(/[^\d.,]/g, '');
    if (!v) return null;
    if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ----- 1) separa em mensagens (com remetente e data quando houver cabeçalho)
  // Formatos: "[18:27, 26/10/2026] Fulano:" (Web) · "[26/10/2026, 18:27:05] Fulano:" / "[10/26/26, 6:27:16 PM] Fulano:" (iPhone)
  //           "26/10/2026 18:27 - Fulano:" / "10/26/26, 6:27 PM - Fulano:" (Android)
  const RE_WEB = /^\[(\d{1,2}):(\d{2}), (\d{1,2})\/(\d{1,2})\/(\d{2,4})\] ([^:]{1,80}): ?/;
  const RE_IOS = /^\[(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),? (\d{1,2}):(\d{2})(?::\d{2})?(?:\s?([AaPp])\.?\s?[Mm]\.?)?\] ([^:]{1,80}): ?/;
  const RE_AND = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),? (\d{1,2}):(\d{2})(?:\s?([AaPp])\.?\s?[Mm]\.?)? [-–] ([^:]{1,80}): ?/;
  function ordemDatas(linhas) {
    // decide se as datas do arquivo estão em dia/mês (Brasil) ou mês/dia (celular configurado em inglês)
    let dm = 0, md = 0, ampm = 0;
    for (const ln of linhas) {
      const m = ln.match(RE_IOS) || ln.match(RE_AND);
      if (!m) continue;
      const a = Number(m[1]), b = Number(m[2]);
      if (a > 12) dm++; if (b > 12) md++; if (m[6]) ampm++;
    }
    if (dm && !md) return 'dm'; if (md && !dm) return 'md';
    return ampm ? 'md' : 'dm';
  }
  function separarMensagens(texto) {
    const linhas = String(texto || '').replace(/\r/g, '').replace(/[‎‏‪-‮⁦-⁩]/g, '').split('\n');
    const ordem = ordemDatas(linhas);
    const msgs = []; let atual = null;
    for (const ln of linhas) {
      let cab = null, m;
      if ((m = ln.match(RE_WEB))) cab = { data: dataISO(m[3], m[4], m[5]), hora: `${m[1]}:${m[2]}`, autor: m[6], resto: ln.slice(m[0].length) };
      else if ((m = ln.match(RE_IOS)) || (m = ln.match(RE_AND))) {
        const [d, mes] = ordem === 'md' ? [m[2], m[1]] : [m[1], m[2]];
        let h = Number(m[4]); if (m[6]) { const pm = /p/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
        cab = { data: dataISO(d, mes, m[3]), hora: `${String(h).padStart(2, '0')}:${m[5]}`, autor: m[7], resto: ln.slice(m[0].length) };
      }
      if (cab) { atual = { data: cab.data, hora: cab.hora, autor: cab.autor.trim(), linhas: [cab.resto] }; msgs.push(atual); }
      else { if (!atual) { atual = { data: null, hora: null, autor: null, linhas: [] }; msgs.push(atual); } atual.linhas.push(ln); }
    }
    return msgs;
  }

  // ----- 2) dentro de cada mensagem, cada "Nome:" começa uma matrícula
  // rótulo seguido de ":" / "-" / espaço(s). A ordem importa: "valor da primeira" antes de "valor".
  const SEP = '(?:\\s*[:\\-–=]\\s*|\\s+)';
  const CAMPOS = [
    ['aluno', new RegExp('^(?:nome(?: do aluno| da aluna| completo)?|aluno|aluna)' + SEP + '(.+)$', 'i')],
    ['cpf', new RegExp('^cpf' + SEP + '?(.+)$', 'i')],
    ['valor_primeira', new RegExp('^(?:valor (?:da |de )?(?:primeira|1a|1ª|1º|1o)(?: parcela| mensalidade)?|primeira(?: parcela| mensalidade)?|(?:1a|1ª|1º|1o|1°)(?: parcela| mensalidade)?|matricula|taxa de matricula|entrada)' + SEP + '(.+)$', 'i')],
    ['mensalidade', new RegExp('^(?:bolsa solicitada|demais(?: parcelas| mensalidades| meses)?|mensalidades?(?: com desconto| com bolsa)?|valor (?:da |de )?mensalidade|valor mensal|valor com desconto|valor com bolsa|mensal|parcelas?|bolsa|valor)' + SEP + '(.+)$', 'i')],
    ['curso', new RegExp('^(?:curso|produto)' + SEP + '(.+)$', 'i')],
    ['origem', new RegExp('^(?:de onde veio|veio por meio(?: de)?|veio atraves de|veio por|veio pelo|veio pela|veio de|origem|como conheceu|como chegou|canal)' + SEP + '?(.+)$', 'i')],
    ['cupom', new RegExp('^cupom' + SEP + '(.+)$', 'i')],
    ['polo', new RegExp('^polo\\s*[:\\-–]\\s*(.+)$', 'i')],
    ['tutor', new RegExp('^(?:tutor|tutora|consultor|consultora|vendedor|vendedora)\\s*[:\\-–]\\s*(.+)$', 'i')],
    ['data', /^data(?: da matricula)?\s*[:\-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i],
  ];
  const RE_NOME = new RegExp('^(?:nome(?: do aluno| da aluna| completo)?|aluno|aluna)' + SEP + '\\S', 'i');
  const LIXO = /^(?:\s*(?:\[encaminhada\]|<[^>]*(?:ocultad|omitid|oculta)[^>]*>|imagem ocultada|midia oculta|<attached:[^>]*>|‎?image omitted)\s*)+/i;
  function prepararLinha(ln) { return semEmoji(String(ln || '').replace(LIXO, '')).replace(/^[•\-–]\s*/, '').trim(); }

  // Acha o valor em reais dentro de um texto como "R$ 173,15 (60+10)", "60+10 (R$ 173,15)", "173.15", "R$1.210,50 com bolsa de 60%".
  function extrairDinheiro(txt) {
    const t = String(txt || '');
    const NUM = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
    const tenta = (re) => { const m = t.match(re); return m ? { valor: valorBR(m[1]), ini: m.index, fim: m.index + m[0].length } : null; };
    let r = tenta(new RegExp('r\\$\\s*' + NUM, 'i'))
      || tenta(new RegExp('(?<![\\d+%])' + '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+\\.\\d{2})(?![\\d%])'))   // com centavos
      || tenta(new RegExp('(?<![\\d+])(\\d{2,5})(?![\\d%+.,])(?!\\s*%)(?!\\s*\\+)'));                  // inteiro que não é % nem "60+10"
    if (r && r.valor != null && /^\s*(?:reais|mensais|\/m[eê]s)?/i.test(t.slice(r.fim))) { /* ok */ }
    if (!r || r.valor == null) return { valor: null, resto: t.trim() };
    if (r.valor < 20 && !/r\$/i.test(t)) return { valor: null, resto: t.trim() }; // "60+10" sem R$ não é valor
    const resto = (t.slice(0, r.ini) + ' ' + t.slice(r.fim)).replace(/\b(?:r\$|reais|mensais|por m[eê]s|\/m[eê]s|de|com bolsa de|com)\b/gi, ' ');
    return { valor: r.valor, resto: resto.replace(/[()=]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '').trim() };
  }
  // linha com dois campos ("Primeira: R$ 19,47 / Demais: R$ 173,15") vira duas
  const RE_DIVIDE = /\s+[\/|;]\s+(?=(?:demais|mensalidade|bolsa|primeira|1a|1ª|curso|cpf|origem|de onde|veio|cupom|valor)\b)/i;

  function dividirOriginal(p) {
    // divide mantendo acentos: acha os pontos de corte no texto normalizado (mesmo tamanho)
    const n = norm(p); const out = []; let ini = 0; const re = new RegExp(RE_DIVIDE.source, 'gi'); let m;
    while ((m = re.exec(n))) { out.push(p.slice(ini, m.index)); ini = m.index + m[0].length; }
    out.push(p.slice(ini)); return out.map(x => x.trim()).filter(Boolean);
  }
  function lerBloco(linhas) {
    const r = { assinatura: [] };
    const linhasDiv = [];
    for (const bruta of linhas) { const p = prepararLinha(bruta); for (const pedaco of norm(p).split(RE_DIVIDE).length > 1 ? dividirOriginal(p) : [p]) linhasDiv.push(pedaco); }
    for (const ln0 of linhasDiv) {
      const ln = ln0;
      if (!ln) continue;
      const lnN = norm(ln);
      let achou = false;
      for (const [campo, re] of CAMPOS) {
        const m = lnN.match(re);
        if (!m) continue;
        achou = true;
        const grupo = m[m.length - 1] || '';
        const valorOrig = ln.slice(ln.length - grupo.length).trim(); // mesmo trecho, com acentos
        if (campo === 'data') { r.data = dataISO(m[1], m[2], m[3] || String(new Date().getFullYear())); }
        else if (campo === 'mensalidade') {
          const { valor, resto } = extrairDinheiro(valorOrig);
          const prioritario = /^(bolsa solicitada|demais|mensalidade|valor (da |de )?mensalidade|valor com)/.test(lnN);
          if (valor != null && (r.mensalidade == null || (prioritario && !r.mens_prioritaria))) { r.mensalidade = valor; r.mens_prioritaria = prioritario; }
          if (resto && !r.bolsa) r.bolsa = resto;
        } else if (campo === 'valor_primeira') { const { valor } = extrairDinheiro(valorOrig); if (valor != null && r.valor_primeira == null) r.valor_primeira = valor; }
        else if (campo === 'cpf') r.cpf = valorOrig.replace(/\D/g, '').slice(0, 11);
        else if (campo === 'curso') {
          // "Graduação / Psicopedagogia" → produto informado + curso
          const partes = valorOrig.split(/\s*[\/|]\s*/).filter(Boolean);
          if (partes.length > 1) { r.tipo_curso = partes[0]; r.curso = partes.slice(1).join(' / '); } else r.curso = valorOrig;
        }
        else if (!r[campo]) r[campo] = valorOrig;
        break;
      }
      if (!achou && !/^(nossa|nosso|mais um|mais uma|bem vind|parab|seja bem|novo aluno|nova aluna|matricula (realizada|feita|efetivada))/.test(lnN)) r.assinatura.push(ln);
    }
    return r;
  }

  function extrair(texto) {
    const saida = [];
    for (const msg of separarMensagens(texto)) {
      const corpo = msg.linhas;
      const inicios = [];
      corpo.forEach((ln, i) => { if (RE_NOME.test(norm(prepararLinha(ln)))) inicios.push(i); });
      if (!inicios.length) continue;
      inicios.forEach((ini, k) => {
        const fim = k + 1 < inicios.length ? inicios[k + 1] : corpo.length;
        const bloco = lerBloco(corpo.slice(ini, fim));
        if (!bloco.cpf && !bloco.mensalidade) return; // não parece matrícula
        saida.push({ ...bloco, data: bloco.data || msg.data, hora: msg.hora, autor: msg.autor, texto: corpo.slice(ini, fim).join('\n').trim() });
      });
    }
    return saida;
  }

  // ----- 3) casa com os cadastros
  function termos(item) { return [item.nome, ...String(item.apelidos || '').split(/[,;]/)].map(limpo).filter(Boolean); }
  function contemTermo(texto, termo) {
    if ((' ' + texto + ' ').includes(' ' + termo + ' ')) return true;
    // nomes grudados ("PoloItapira", "FrancaSP"): compara sem espaços para termos com 5+ letras
    const t = termo.replace(/ /g, '');
    return t.length >= 5 && texto.replace(/ /g, '').includes(t);
  }
  function melhorPorTexto(lista, texto) {
    const t = limpo(texto); if (!t) return null;
    let melhor = null, tam = 0;
    for (const it of lista) for (const tm of termos(it)) if (tm && contemTermo(t, tm) && tm.length > tam) { melhor = it; tam = tm.length; }
    return melhor;
  }
  // Reconhece a origem, mantendo o canal de contato separado da origem de captação.
  function identificarOrigem(texto, origens) {
    const t = limpo(texto); if (!t) return { origem: null, ambigua: false };
    const ativas = origens.filter(o => o.ativo);
    const porNome = nome => ativas.find(o => limpo(o.nome) === nome);
    const sinais = [];
    const add = (nome, re) => { if (re.test(t)) sinais.push(nome); };
    add('resgate de base', /\bresgate\b/);
    add('indicacao', /\b(indicacao|indicou|eu indico)\b/);
    add('pre', /\b(pre|pre inscricao|pre matricula)\b/);
    add('marketing digital', /\b(marketing|mkt|trafego|instagram|insta|facebook|google|digital influencer)\b/);
    add('pap panfletagem', /\b(pap|panfletagem|porta a porta)\b/);
    add('parcerias', /\b(parceria|parcerias|convenio|empresa|empresas|loja|lojas)\b/);
    add('ja e aluno aluna', /\b(ja e (?:nossa |nosso )?alun[oa]|alun[oa] ativ[oa])\b/);
    add('ex aluno', /\b(ex aluno|ex aluna|exaluno|exaluna)\b/);
    add('egresso', /\b(egresso|egressa)\b/);
    // Expressões de canal não anulam uma origem explicitamente indicada.
    const receptivo = /\b(receptivo|recepcao|passante|balcao|telefone|whatsapp|whats|veio (?:ao|no|a[o]?|ate o) polo|ligou (?:no|para o) polo)\b/.test(t);
    const distintos = [...new Set(sinais)];
    if (distintos.length > 1) return { origem: null, ambigua: true };
    if (distintos.length === 1) return { origem: porNome(distintos[0]) || null, ambigua: false };
    const exatos = ativas.filter(o => termos(o).includes(t));
    if (exatos.length === 1) return { origem: exatos[0], ambigua: false };
    if (exatos.length > 1) return { origem: null, ambigua: true };
    if (receptivo) return { origem: porNome('receptivo') || null, ambigua: false };
    const candidatas = ativas.filter(o => termos(o).some(tm => contemTermo(t, tm)));
    return { origem: candidatas.length === 1 ? candidatas[0] : null, ambigua: candidatas.length > 1 };
  }
  // Classifica o curso escrito na mensagem em um produto (linha de meta), respeitando o que o polo vende.
  // Ordem: 1) cursos cadastrados (os do polo têm prioridade; nome exato antes de "contém")
  //        2) regras fixas: Educação Física bacharel/licenciatura, "licenciatura", PowerTech, Pós/Técnico/Prof
  //        3) padrão: primeiro produto da Graduação (EAD), marcado como sugestão para conferir
  function classificarCurso(it, poloId, cad) {
    const polo = cad.polos.find(p => p.id === poloId);
    const vende = (pid) => !polo || !polo.produtos || polo.produtos.includes(pid);
    const prodAtivo = (pid) => cad.produtos.find(p => p.id === pid && p.ativo);
    const texto = limpo([it.tipo_curso, it.curso].filter(Boolean).join(' '));
    const curso = limpo(it.curso || '');
    // Pós / Técnico / Prof: pelo nome do produto (as categorias agora são só Graduação e Continuada)
    const porCat = (re) => cad.produtos.filter(p => p.ativo && vende(p.id) && re.test(limpo(p.nome)));
    const porNome = (re) => cad.produtos.find(p => p.ativo && vende(p.id) && re.test(limpo(p.nome)));
    const r = (p, extra = {}) => ({ produto_id: p ? p.id : null, ...extra });

    // 0) Educação continuada e engenharia são decididas pelo próprio texto (antes de olhar nomes de curso)
    if (/\b(pos|pos graduacao|mba|especializacao|mestrado)\b/.test(texto)) return r(porCat(/^pos/)[0]);
    if (/\btecnico\b/.test(texto) && !/\btecnologo\b/.test(texto)) return r(porCat(/^tec/)[0]);
    if (/\b(profissionalizante|curso livre)\b/.test(texto)) return r(porCat(/^prof/)[0]);
    if (/\bengenharia\b/.test(texto) && !/\b(power ?tech|pwt)\b/.test(texto)) {
      const eng = cad.produtos.find(p => p.ativo && vende(p.id) && /\bengenharia/.test(limpo(p.nome)) && !/power/.test(limpo(p.nome)));
      return eng ? r(eng) : { produto_id: null, aviso_curso: 'Este polo não vende Engenharia' };
    }
    // Curso conhecido em outro polo não pode cair na sugestão genérica de EAD.
    const correspondencias = (cad.cursos || []).filter(c => c.ativo !== 0 && termos(c).some(t => t === curso || (t.length >= 5 && contemTermo(curso, t))));
    if (correspondencias.length && !correspondencias.some(c => (!c.polos || !c.polos.length || (poloId && c.polos.includes(poloId))) && vende(c.produto_id)))
      return { produto_id: null, curso_conhecido: true, aviso_curso: poloId ? 'Curso cadastrado, mas não disponível para este polo. Confira o vínculo do produto e do curso.' : 'Curso cadastrado. Selecione o polo para verificar o produto.' };
    // 1) cursos cadastrados
    const cursos = (cad.cursos || []).filter(c => c.ativo !== 0 && (!c.polos || !c.polos.length || (poloId && c.polos.includes(poloId))));
    const doPolo = (c) => c.polos && c.polos.length ? 1 : 0;
    let achado = null, nivel = 0;
    for (const c of cursos) {
      const ts = termos(c);
      let n = 0;
      if (ts.includes(curso)) n = 3;                                   // nome igual
      else if (ts.some(t => t.length >= 5 && contemTermo(curso, t))) n = 2; // "Letras Português" contém "Letras"
      if (!n) continue;
      const score = n * 10 + doPolo(c);
      if (score > nivel && vende(c.produto_id)) { achado = c; nivel = score; }
    }
    // 2) regras
    if (/\beducacao fisica\b|\bed fisica\b/.test(texto)) {
      if (/\bbachar/.test(texto)) { const produto = porNome(/\bbacharel/); const conhecido = (cad.cursos || []).find(c => c.ativo !== 0 && produto && c.produto_id === produto.id && /educacao fisica/.test(limpo(c.nome))); return r(produto, { curso_id: conhecido?.id || null, curso_conhecido: !!conhecido }); }
      if (/\blicenc/.test(texto)) { const produto = porNome(/\blicenciatura/); const conhecido = (cad.cursos || []).find(c => c.ativo !== 0 && produto && c.produto_id === produto.id && /educacao fisica/.test(limpo(c.nome))); return r(produto, { curso_id: conhecido?.id || null, curso_conhecido: !!conhecido }); }
      return { produto_id: null, aviso_curso: 'Educação Física sem dizer se é Bacharel ou Licenciatura' };
    }
    if (!achado && /^(recursos humanos|rh)$/.test(curso)) {
      const rh = cursos.find(c => termos(c).includes('gestao de recursos humanos') && vende(c.produto_id));
      if (rh) return { produto_id: rh.produto_id, curso_id: rh.id, curso_conhecido: true, sugerido: true };
    }
    if (achado) return { produto_id: achado.produto_id, curso_id: achado.id, curso_conhecido: true };
    if (/\b(power ?tech|pwt|power)\b/.test(texto)) {
      const pw = cad.produtos.filter(p => p.ativo && vende(p.id) && /power/.test(limpo(p.nome)));
      const eng = pw.find(p => /eng/.test(limpo(p.nome))), sau = pw.find(p => /saude/.test(limpo(p.nome)));
      if (/industrial|engenharia|automacao|manutencao/.test(texto) && eng) return r(eng);
      if (sau && !eng) return r(sau, { sugerido: true });
      if (pw.length) return r(pw[0], { sugerido: true });
    }
    if (/\blicenciatura\b/.test(texto)) return r(porNome(/\blicenciatura/));
    if (/\b(tec|prof)\b/.test(texto)) return r(porCat(/^tec/)[0] && /\btec\b/.test(texto) ? porCat(/^tec/)[0] : porCat(/^prof/)[0]);
    if (/\b(hibrido|hib|semipresencial)\b/.test(texto)) return { produto_id: null };
    const direto = cad.produtos.find(p => p.ativo && vende(p.id) && limpo(p.nome) === curso);
    if (direto) return r(direto);
    return { produto_id: null, aviso_curso: 'Curso não identificado. Selecione e confira o produto manualmente.' };
  }

  function casar(itens, cad, opcoes = {}) {
    const polos = cad.polos.filter(p => p.ativo);
    const tutores = cad.tutores.filter(t => t.ativo);
    return itens.map(it => {
      const fonte = [it.polo, it.tutor, it.assinatura.join(' '), it.autor].filter(Boolean).join(' | ');
      const r = { ...it, avisos: [] };
      // polo: campo "Polo:", assinatura, depois nome de quem postou
      const polo = melhorPorTexto(polos, it.polo || '') || melhorPorTexto(polos, it.assinatura.join(' ')) || melhorPorTexto(polos, it.autor || '');
      r.polo_id = polo ? polo.id : null;
      // Tutor pode vender para outro polo. Identidade é resolvida antes do destino comercial.
      const candTut = tutores;
      let tutor = melhorPorTexto(candTut, it.tutor || '') || melhorPorTexto(candTut, it.assinatura.join(' ')) || melhorPorTexto(candTut, it.autor || '');
      if (!tutor) tutor = melhorPorTexto(tutores, fonte);
      if (!tutor) {
        // só o primeiro nome ("Fernanda" para "Fernanda Marinho"), se for único entre os tutores do polo
        const txt = ' ' + limpo([it.tutor, it.assinatura.join(' '), it.autor].filter(Boolean).join(' ')) + ' ';
        const porPrimeiro = candTut.filter(t => { const p1 = limpo(t.nome).split(' ')[0]; return p1.length >= 3 && txt.includes(' ' + p1 + ' '); });
        if (porPrimeiro.length === 1) tutor = porPrimeiro[0];
      }
      if (tutor && !r.polo_id && tutor.polos.length === 1) r.polo_id = tutor.polos[0];
      r.tutor_id = tutor ? tutor.id : null;
      r.tutor_polo_id = tutor?.polo_origem_id || (tutor && tutor.polos.length===1 ? tutor.polos[0] : null);
      // curso → produto (depende do polo: ex.: Serviço Social em Franca/Itapira = PowerTech Saúde)
      let cl = it.curso || it.tipo_curso ? classificarCurso(it, r.polo_id, cad) : { produto_id: null };
      if (!cl.produto_id && cl.curso_conhecido && it.curso) {
        const destinos = polos.map(p => ({ p, cl: classificarCurso(it, p.id, cad) })).filter(x => x.cl.produto_id && x.cl.curso_conhecido);
        if (destinos.length === 1) { r.polo_id = destinos[0].p.id; cl = destinos[0].cl; r.polo_redirecionado = true; }
        else if (destinos.length > 1) { r.polo_id = null; cl = { produto_id: null, curso_conhecido: true, aviso_curso: 'Curso disponível em mais de um polo. Selecione o polo de destino.' }; }
      }
      r.produto_id = cl.produto_id || null;
      r.curso_id = cl.curso_id || null;
      r.curso_novo = !!(it.curso && !cl.curso_conhecido);
      r.produto_sugerido = !!cl.sugerido;
      if (cl.aviso_curso) r.aviso_curso = cl.aviso_curso;
      if (!r.produto_id && opcoes.produtoPadrao) { r.produto_id = opcoes.produtoPadrao; r.produto_sugerido = true; }
      // origem
      const resultadoOrigem = identificarOrigem(it.origem, cad.origens);
      const org = resultadoOrigem.origem;
      r.origem_ambigua = resultadoOrigem.ambigua;
      r.origem_id = org ? org.id : null;
      r.origem_nova = !!(it.origem && !org);
      r.data = r.data || opcoes.hoje;
      return r;
    });
  }

  // Lê o .txt de dentro do .zip exportado pelo WhatsApp (sem bibliotecas: usa o descompactador do navegador)
  async function textoDoZip(buf) {
    const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo .zip inválido');
    const total = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const arquivos = [];
    for (let k = 0; k < total; k++) {
      const metodo = dv.getUint16(p + 10, true), tamC = dv.getUint32(p + 20, true), nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLen));
      arquivos.push({ nome, metodo, tamC, loc }); p += 46 + nLen + xLen + cLen;
    }
    const alvo = arquivos.find(a => /(^|\/)_?chat\.txt$/i.test(a.nome)) || arquivos.find(a => /\.txt$/i.test(a.nome));
    if (!alvo) throw new Error('Não achei o arquivo .txt da conversa dentro do .zip');
    const ini = alvo.loc + 30 + dv.getUint16(alvo.loc + 26, true) + dv.getUint16(alvo.loc + 28, true);
    const dados = u8.subarray(ini, ini + alvo.tamC);
    if (alvo.metodo === 0) return new TextDecoder().decode(dados);
    if (alvo.metodo !== 8) throw new Error('Compactação do .zip não suportada');
    const ds = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  }

  const api = { extrair, casar, separarMensagens, valorBR, limpo, textoDoZip, classificarCurso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LeitorWhatsApp = api;
})(typeof window !== 'undefined' ? window : globalThis);
