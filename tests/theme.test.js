'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../brand/theme.js'),'utf8');
function start(storage,blocked=false){
 const events={};const root={dataset:{}};const document={documentElement:root,querySelectorAll:()=>[],addEventListener:()=>{}};
 const window={matchMedia:()=>({matches:true}),dispatchEvent:()=>{},addEventListener:(name,fn)=>events[name]=fn};
 const localStorage={getItem:k=>{if(blocked)throw Error();return storage[k]??null},setItem:(k,v)=>{if(blocked)throw Error();storage[k]=v}};
 vm.runInNewContext(code,{document,window,localStorage,location:{pathname:"/conecta/"},CustomEvent:class{}});return {root,manager:window.BalbinoTheme,events};
}
test('migra tema antigo e mantém a escolha ao abrir outro módulo',()=>{
 const data={'mat:tema':'"claro"'};const first=start(data);assert.equal(first.root.dataset.theme,'light');
 first.manager.set('escuro');const next=start(data);assert.equal(next.root.dataset.theme,'dark');assert.equal(next.root.dataset.tema,'escuro');assert.equal(data['mat:tema'],'"escuro"');assert.equal(data['balbino-portal-theme-v1'],'dark');
 next.events.storage({key:'redebalbino:theme',newValue:'light'});assert.equal(next.root.dataset.tema,'claro');
});
test('tema funciona quando o navegador bloqueia armazenamento',()=>{
 const app=start({},true);app.manager.set('dark');assert.equal(app.root.dataset.theme,'dark');app.manager.set('claro');assert.equal(app.root.dataset.tema,'claro');
});
