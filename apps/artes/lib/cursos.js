// Transforma um curso cadastrado nos campos da arte "Divulgação de curso" ou "Oferta do curso"
function temPreco(c) {
  return Boolean(c && String(c.preco_desconto || '').trim());
}

function observacaoOferta(desconto) {
  if (!String(desconto || '').trim()) return undefined;
  return 'Consulte as condições comerciais vigentes.';
}

function dadosDoCurso(c, tipoId = 'curso') {
  const base = { linha1: c.linha1 || '', linha2: c.linha2 || '', curso: c.curso, icone: c.icone || '' };
  // A Black Friday usa os mesmos campos de preço da Oferta do curso
  if (!['oferta', 'black'].includes(tipoId)) return { ...base, nivel: c.nivel || '', detalhe: c.detalhe || '' };
  const d = { ...base };
  if (String(c.primeira || '').trim()) d.primeira = c.primeira;
  const desc = String(c.desconto || '').trim();
  d.desconto = desc ? (/off/i.test(desc) ? desc : `${desc} OFF`) : '';
  d.preco_cheio = c.preco_cheio || '';
  d.mensalidade = c.preco_desconto || '';
  const obs = observacaoOferta(desc);
  if (obs) d.observacao = obs;
  return d;
}

module.exports = { dadosDoCurso, temPreco, observacaoOferta };
