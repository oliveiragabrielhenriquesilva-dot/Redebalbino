'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../apps/conecta/public/app.js'),'utf8');
function context(){const ctx={matrixTools:()=>'',matrixPanel:()=>'',Map,Intl,document:{addEventListener(){}},modalityLabel:c=>c.modalidade==='ead'?'EAD':'Semipresencial',esc:s=>String(s).replace(/</g,'&lt;')};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const feeState='),source.indexOf('function openCourse(')),ctx);return ctx;}
test('pontualidade é fixa em 10% inclusive se argumento antigo tentar alterar',()=>{const c=context();const result=vm.runInContext('feeCalculation(49799,3000,0)',c);assert.equal(result.without,34859);assert.equal(result.final,31373);assert.equal(vm.runInContext('feeCalculation(10000,0).final',c),9000);assert.equal(vm.runInContext('feeCalculation(10000,10000).final',c),0);});
test('desconto aceita vírgula e rejeita percentuais fora do limite ou vazios',()=>{const c=context();for(const [input,expected] of [['35,5',3550],['0',0],['100',10000],['',null],['-1',null],['101',null],['1,234',null]])assert.equal(vm.runInContext(`percentage(${JSON.stringify(input)})`,c),expected);});
test('mensagem de reabertura usa o mesmo cálculo em centavos',()=>{const c=context();c.course={name:'Administração',modalidade:'ead',duracao:'4 anos'};c.price={price:49799};const msg=vm.runInContext('feeMessage(course,price,3000)',c);assert.match(msg,/retomar seu interesse/);assert.match(msg,/313,73/);assert.match(msg,/348,59/);assert.match(msg,/30%/);assert.match(msg,/10%/);assert.doesNotMatch(msg,/inscrições abertas|vagas garantidas/i);});
test('interface não oferece alteração da pontualidade e exige desconto explícito',()=>{const c=context();c.course={id:'c1',name:'Administração',modalidade:'ead',pricing:{code:'X'},pricingOptions:[{code:'X',price:49799}]};const markup=vm.runInContext('feeMarkup(course)',c);assert.doesNotMatch(markup,/id="feePunctual"/);assert.match(markup,/Pontualidade fixa de 10%/);assert.match(markup,/Gerar e copiar mensagem de reabertura/);assert.match(markup,/id="feeGenerate" disabled/);assert.equal(vm.runInContext('feeSettings(course).discount',c),'');assert.match(source,/feeMessagePanel'\).hidden=true/);});

test('padrão compartilhado preenche desconto e modelo da mensagem; ajuste manual é preservado',()=>{
 const c=context();c.course={id:'c1',name:'Administração',modalidade:'ead',duracao:'4 anos'};
 vm.runInContext("feePolicy={revision:'a',products:[{id:1,nome:'Graduação',ativo:1,discountBps:3550}],courses:[{id:'c1',productId:1}],messageTemplate:'Curso: {curso}\\nValor: {mensalidade} / {pontualidade}%'}",c);
 assert.equal(vm.runInContext('feeSettings(course).discount',c),'35,5');
 const message=vm.runInContext('feeMessage(course,{price:10000},3550)',c);assert.match(message,/Administração/);assert.match(message,/58,05/);assert.match(message,/10%/);assert.equal(message.split('\n').length,2);
 vm.runInContext("feeSettings(course).manual=true;feeSettings(course).discount='40';feePolicy.revision='b';feePolicy.products[0].discountBps=5000",c);assert.equal(vm.runInContext('feeSettings(course).discount',c),'40');
 vm.runInContext('feeSettings(course).manual=false;feePolicy.revision="c"',c);assert.equal(vm.runInContext('feeSettings(course).discount',c),'50');
});
test('ação de reabertura exibe e copia no mesmo clique, sem botão separado',()=>{
 assert.doesNotMatch(source,/id="feeCopy"/);assert.match(source,/feeMessagePanel'\).hidden=false;await copyFeeMessage/);assert.match(source,/navigator.clipboard.writeText\(text\)/);
});
test('um clique revela a mensagem e chama a cópia automaticamente',async()=>{
 const handlers={},nodes={feeDiscount:{value:'30'},feeMessage:{value:''},feeMessagePanel:{hidden:true},feeCopyStatus:{textContent:''}};let copied='';
 const ctx={matrixTools:()=>'',matrixPanel:()=>'',Map,Intl,$:id=>nodes[id],document:{addEventListener:(event,fn)=>{(handlers[event]??=[]).push(fn);}},navigator:{clipboard:{writeText:async text=>{copied=text;}}},modalityLabel:()=> 'EAD',esc:String,selected:{id:'a',name:'Administração',modalidade:'ead',pricing:{code:'A'},pricingOptions:[{code:'A',price:10000}]}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const feeState='),source.indexOf('function openCourse(')),ctx);
 await handlers.click[0]({target:{closest:selector=>selector==='#feeGenerate'?{}:null}});
 assert.equal(nodes.feeMessagePanel.hidden,false);assert.equal(copied,nodes.feeMessage.value);assert.match(copied,/63,00/);assert.match(nodes.feeCopyStatus.textContent,/Mensagem copiada/);
});
test('preço aparece quando a tabela chega depois de abrir o curso sem cotação',()=>{const c=context();c.course={id:'c1',name:'Administração',modalidade:'ead',pricing:null,pricingOptions:[]};assert.equal(vm.runInContext('feePrice(course)',c),null);c.course.pricing={code:'EGRAD_ADM',price:48399};c.course.pricingOptions=[c.course.pricing];assert.equal(vm.runInContext('feePrice(course).price',c),48399);assert.equal(vm.runInContext('feeSettings(course).code',c),'EGRAD_ADM');c.course.pricing={code:'OUTRO',price:53099};c.course.pricingOptions=[c.course.pricing];assert.equal(vm.runInContext('feePrice(course).price',c),53099);});
