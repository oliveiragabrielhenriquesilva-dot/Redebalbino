'use strict';
/* Leitura de tabelas vindas do BI: texto colado (Power BI / Excel), CSV ou .xlsx exportado.
   Devolve linhas { rotulo, meta_qtd, real_qtd, meta_ticket, real_ticket, meta_rpv, real_rpv }. */
(function (raiz) {
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function numero(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let t = String(v).replace(/[^\d.,\-]/g, '');
    if (!t || t === '-') return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  // ---------- .xlsx (zip + XML) sem bibliotecas
  async function arquivosZip(buf) {
    const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo inválido (não é .xlsx)');
    const total = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const lista = {};
    for (let k = 0; k < total; k++) {
      const metodo = dv.getUint16(p + 10, true), tamC = dv.getUint32(p + 20, true), nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLen));
      lista[nome] = async () => {
        const ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
        const dados = u8.subarray(ini, ini + tamC);
        if (metodo === 0) return new TextDecoder().decode(dados);
        const ds = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(ds).text();
      };
      p += 46 + nLen + xLen + cLen;
    }
    return lista;
  }
  function colunaIdx(ref) { const l = ref.replace(/\d+/g, ''); let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
  async function lerXlsx(buf) {
    const arqs = await arquivosZip(buf);
    if (arqs['xl/connections.xml'] && !Object.keys(arqs).some(n => /sharedStrings/.test(n))) {
      const s1 = arqs['xl/worksheets/sheet1.xml'] ? await arqs['xl/worksheets/sheet1.xml']() : '';
      if (!/<v>|<is>/.test(s1)) throw new Error('Este .xlsx é "Excel com conexão dinâmica" e não traz os números. No Power BI, exporte como "Excel (.xlsx)" ou "CSV".');
    }
    const parser = new DOMParser();
    const shared = [];
    if (arqs['xl/sharedStrings.xml']) {
      const x = parser.parseFromString(await arqs['xl/sharedStrings.xml'](), 'application/xml');
      for (const si of x.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    }
    // primeira planilha que tenha dados
    const folhas = Object.keys(arqs).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    for (const f of folhas) {
      const x = parser.parseFromString(await arqs[f](), 'application/xml');
      const linhas = [];
      for (const row of x.getElementsByTagName('row')) {
        const cel = [];
        for (const c of row.getElementsByTagName('c')) {
          const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0];
          let val = null;
          if (t === 's' && v) val = shared[Number(v.textContent)];
          else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(z => z.textContent).join('');
          else if (v) val = t === 'str' ? v.textContent : Number(v.textContent);
          cel[colunaIdx(c.getAttribute('r') || 'A1')] = val;
        }
        if (cel.some(v => v != null && v !== '')) linhas.push(cel);
      }
      if (linhas.length) return linhas;
    }
    return [];
  }

  // ---------- texto (colado do Power BI / Excel, ou CSV)
  function lerTexto(txt) {
    const linhas = String(txt || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
    const tab = linhas.some(l => l.includes('\t'));
    const pv = !tab && linhas.filter(l => l.includes(';')).length >= 2;
    return linhas.map(l => tab ? l.split('\t') : pv ? l.split(';') : l.trim().split(/\s{2,}|\s(?=[\d\-R])/));
  }

  // ---------- interpreta a tabela: acha o cabeçalho e as colunas de meta/real
  const COLUNAS = [
    ['meta_qtd', /^meta (de )?(matricula|matriculas|captacao|qtd|quantidade)/], ['real_qtd', /^(real|realizado) (de )?(matricula|matriculas|captacao|qtd|quantidade)|^(matriculas|qtd ra gerado|ra gerado|qtd)$/],
    ['meta_ticket', /^meta (de )?ticket/], ['real_ticket', /^(real|realizado) (de )?ticket|^ticket( medio)?$/],
    ['meta_rpv', /^meta (de )?rpv/], ['real_rpv', /^(real|realizado) (de )?rpv|^rpv$/],
  ];
  function interpretar(linhas) {
    let h = -1, mapa = {};
    for (let i = 0; i < Math.min(linhas.length, 15) && h < 0; i++) {
      const m = {};
      linhas[i].forEach((c, j) => { const n = norm(c); for (const [k, re] of COLUNAS) if (m[k] == null && re.test(n)) m[k] = j; });
      if (Object.keys(m).length >= 2) { h = i; mapa = m; }
    }
    if (h < 0) throw new Error('Não encontrei o cabeçalho (ex.: META MATRICULA, REAL MATRICULA, META TICKET…). Cole a tabela com a linha de títulos.');
    const out = [];
    for (const l of linhas.slice(h + 1)) {
      const rot = String(l[0] ?? '').trim();
      if (!rot || /^total/i.test(norm(rot))) continue;
      const r = { rotulo: rot };
      for (const k of Object.keys(mapa)) r[k] = numero(l[mapa[k]]);
      if (r.real_rpv == null && r.real_qtd != null && r.real_ticket != null) r.real_rpv = Math.round(r.real_qtd * r.real_ticket * 100) / 100;
      if (r.meta_rpv == null && r.meta_qtd != null && r.meta_ticket != null) r.meta_rpv = Math.round(r.meta_qtd * r.meta_ticket * 100) / 100;
      if (r.real_ticket == null && r.real_rpv != null && r.real_qtd) r.real_ticket = r.real_rpv / r.real_qtd;
      if (Object.keys(mapa).some(k => r[k] != null)) out.push(r);
    }
    return out;
  }

  raiz.LeitorPlanilha = { lerXlsx, lerTexto, interpretar, numero };
})(window);
