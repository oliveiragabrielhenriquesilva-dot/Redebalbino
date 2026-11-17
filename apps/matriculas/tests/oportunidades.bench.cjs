const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'opp-bench-'));process.env.MATRICULAS_DATA_DIR=temp;
const {db,oportunidades:op}=require(path.join(__dirname,'../server.js'));
try{
 db.exec(`INSERT INTO ciclos(id,nome,padrao) VALUES(99,'Benchmark sintético',0); INSERT OR IGNORE INTO categorias(id,nome) VALUES(1,'Graduação'); INSERT OR IGNORE INTO produtos(id,nome,categoria_id) VALUES(1,'Graduação',1); INSERT INTO produtos(id,nome,categoria_id) VALUES(90,'Semi - Engenharia',1);`);
 const pole=db.prepare('INSERT INTO polos(id,nome,apelidos) VALUES(?,?,?)');const course=db.prepare('INSERT INTO cursos(nome,produto_id,apelidos,polos) VALUES(?,?,?,?)');
 db.exec('BEGIN');for(let i=20;i<30;i++)pole.run(i,'Polo Teste '+i,'PT '+i);for(let i=0;i<160;i++)course.run('Curso teste '+i,90,'Apelido teste '+i,'20,21,22,23,24,25,26,27,28,29');
 const ins=db.prepare("INSERT INTO ma_oportunidades(ciclo_id,identificador,nome,cpf,curso_cod,curso_nome,polo_fonte,status_origem,responsavel_origem,data_registro,data_retorno_origem) VALUES(99,?,?,?,?,?,?,?,?,?,?)");
 for(let i=0;i<3173;i++)ins.run(String(i),'Candidato Teste '+i,null,'ESPRE_'+(i%160),'Curso teste '+(i%160),'Polo Teste '+(20+i%10),['Inscrito','Qualificado','Boleto vencido'][i%3],'Tutor '+i%5,'2026-11-01',i%3?'2026-11-20':'2026-11-01');db.exec('COMMIT');
 const user={id:1,login:'benchmark',nome:'Teste',papel:'admin'};
 const measure=(fn,n=3)=>{const times=[];for(let i=0;i<n;i++){const t=performance.now();fn();times.push(Math.round((performance.now()-t)*100)/100);}return times};
 const result={rows:3173,courses:160,opcoes_ms:measure(()=>op.opcoes({ciclo:99},user)),painel_ms:measure(()=>op.painel({ciclo:99},user)),filtro_polo_ms:measure(()=>op.painel({ciclo:99,polo:'20'},user)),lista_ms:measure(()=>op.lista({ciclo:99,pagina:1,por_pagina:50},user)),detalhe_ms:measure(()=>op.detalhe(1,user))};console.log(JSON.stringify(result));
}finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
