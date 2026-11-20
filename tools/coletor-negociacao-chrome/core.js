(function(root){
'use strict';
const LIST='#!/app/acoes-inadimplentes-alunos/';
const RA=/^\d{6,12}-\d{1,2}$/;
const safeAction=v=>/^\d{1,10}$/.test(String(v));
function key(item){return item.ra+'/'+item.action;}
function money(raw){const value=String(raw).replace(/^R\$\s*/, '').replace(/\s/g,'');if(!/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(value))throw Error('Valor monetário não reconhecido.');const [whole,cents]=value.replace(/\./g,'').split(',');const n=Number(whole)*100+Number(cents);if(!Number.isSafeInteger(n)||n<0||n>1e12)throw Error('Valor fora do limite de leitura.');return n;}
function detailHash(item){if(!RA.test(item.ra)||!safeAction(item.action))throw Error('RA ou ação inválida.');return '#!/app/acoes-inadimplentes-atendimentos/new/'+item.ra+'/'+item.action;}
function route(hash){const match=String(hash).match(/^#!\/app\/acoes-inadimplentes-atendimentos\/new\/(\d{6,12}-\d{1,2})\/(\d{1,10})\/?$/);return match?{ra:match[1],action:match[2]}:null;}
function parseSummary(text,expected,hash,finalInput){
 const page=route(hash);if(!page||page.ra!==expected.ra||String(page.action)!==String(expected.action))throw Error('A página aberta não corresponde ao RA e à ação esperados.');
 const ra=String(text).match(/R\.?A\.?\s*:\s*(\d{6,12}-\d{1,2})/i)?.[1];if(ra!==expected.ra)throw Error('O cabeçalho ainda não corresponde ao RA esperado.');
 const headerAction=String(text).match(/Ação\s*:\s*(\d+)/i)?.[1];if(headerAction!==String(expected.action))throw Error('A ação exibida ainda não corresponde à ação esperada.');
 const number='(R\\$\\s*[\\d.]+,\\d{2})';
 const pick=label=>{const match=String(text).match(new RegExp(label+'\\s*:\\s*'+number,'i'));if(!match)throw Error('Campo não disponível: '+label);return money(match[1]);};
 const debtCents=pick('Devedor'),discountCents=pick('Desconto'),cashCents=pick('À\\s*Vista');
 if(Math.abs(debtCents-discountCents-cashCents)>1)throw Error('Saldo menos desconto não confere com o valor à vista.');
 if(finalInput===undefined||money(finalInput)!==cashCents)throw Error('O valor à vista não confere com o campo de pagamento.');
 const count=String(text).match(/Cobrança em Aberto\s*\((\d+)\)/i);if(!count)throw Error('Quantidade de cobranças indisponível.');
 const course=String(text).match(/Curso\s*:\s*([^\s]+)/i)?.[1]||expected.course||'';
 return {ra,action:String(expected.action),course,debtCents,discountCents,cashCents,openCharges:Number(count[1])};
}
function fmt(n){return (n/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function csv(records){const headers=['RA','Ação','Curso','Saldo devedor','Desconto apresentado','Valor à vista','Cobranças abertas','Consultado em (ISO)','Situação','Erro'];const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,m=>"'"+m).replace(/"/g,'""')+'"';return '\uFEFF'+[headers,...records.map(r=>[r.ra,r.action,r.course,r.status==='ok'?fmt(r.debtCents):'',r.status==='ok'?fmt(r.discountCents):'',r.status==='ok'?fmt(r.cashCents):'',r.openCharges??'',r.capturedAt||'',r.status,r.error||''])].map(row=>row.map(cell).join(';')).join('\r\n');}
const api={LIST,RA,key,money,detailHash,route,parseSummary,fmt,csv};if(typeof module==='object'&&module.exports)module.exports=api;else root.BalbinoCollectorCore=api;
})(typeof globalThis==='undefined'?this:globalThis);
