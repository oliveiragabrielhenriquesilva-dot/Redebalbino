// Utilidades de data, dinheiro e telefone. Fuso de negócio: America/Sao_Paulo.

const FUSO = 'America/Sao_Paulo';

export function hoje(agora = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(agora));
  return p; // AAAA-MM-DD
}

export function diasEntre(dataA, dataB) {
  const a = Date.UTC(...dataA.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  const b = Date.UTC(...dataB.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  return Math.round((b - a) / 86400000);
}

export function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && a >= 1990 && a <= 2100;
}

// Aceita AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA ou número serial do Excel.
export function normalizarData(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number' || /^\d{5}(\.\d+)?$/.test(String(valor).trim())) {
    const serial = Number(valor);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400000);
      const iso = new Date(ms).toISOString().slice(0, 10);
      return dataValida(iso) ? iso : null;
    }
    return null;
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dataValida(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return dataValida(iso) ? iso : null;
  }
  return null;
}

// Competência: AAAA-MM. Aceita MM/AAAA, AAAA-MM, AAAA/MM.
export function normalizarCompetencia(valor) {
  const s = String(valor ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, '0')}` : undefined;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, '0')}` : undefined;
  return undefined; // inválida
}

// Converte "1.234,56", "1234.56", "R$ 1.234,56" ou número para centavos (inteiro). Retorna null se inválido.
export function paraCentavos(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  let s = String(valor).replace(/R\$/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const temVirgula = s.includes(',');
  if (temVirgula) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function formatarReais(centavos) {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Telefone brasileiro em dígitos com DDI 55. Retorna null se inválido.
export function normalizarTelefone(valor) {
  let d = String(valor ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

export function mascararTelefone(tel) {
  if (!tel) return null;
  return tel.slice(0, 4) + '•••••' + tel.slice(-4);
}

export function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
