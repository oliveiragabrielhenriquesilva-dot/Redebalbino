'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const arquivo = path.join(__dirname, 'dados', 'matriculas.db');
if (!fs.existsSync(arquivo)) { console.error('ERRO: banco não encontrado. Coloque este arquivo na pasta do sistema, junto ao iniciar.bat e à pasta dados.'); process.exit(1); }
const dados = {
 'Franca': {'EAD':80,'Licenciatura':90,'Bacharel em Ed. Física':44,'Engenharia':52,'Biomedicina e Farmácia':60,'Nutrição':31,'Bem Estar':73,'Fono':20,'PowerTech Engenharia':20,'PowerTech Saúde':24},
 'Batatais': {'EAD':90,'Licenciatura':47,'Bacharel em Ed. Física':20},
 'Ribeirão Preto': {'EAD':90,'Licenciatura':45,'Bacharel em Ed. Física':20},
 'Ituverava': {'EAD':73,'Licenciatura':40,'Bacharel em Ed. Física':20},
 'São Joaquim da Barra': {'EAD':73,'Licenciatura':40,'Bacharel em Ed. Física':20},
 'Itapira': {'EAD':70,'Licenciatura':45,'Bacharel em Ed. Física':20,'PowerTech Saúde':20},
 'Mogi Guaçu': {'EAD':80,'Licenciatura':40,'Bacharel em Ed. Física':20},
 'Mogi Mirim': {'EAD':57,'Licenciatura':32,'Bacharel em Ed. Física':20},
 'Monte Sião': {'EAD':60,'Licenciatura':34,'Bacharel em Ed. Física':29}
};
let db;
try {
 db = new DatabaseSync(arquivo, {allowExtension: false});
 db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
 const ciclo = db.prepare('SELECT id,nome FROM ciclos').all().filter(x=>/(^|\D)51\/2027(\D|$)/.test(x.nome));
 if (ciclo.length !== 1) throw new Error('O processo 51/2027 não foi encontrado de forma única. Nenhuma meta foi alterada.');
 const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const polos=db.prepare('SELECT id,nome FROM polos').all(), produtos=db.prepare('SELECT id,nome FROM produtos').all();
 const achar=(lista,nome,tipo)=>{ const a=lista.filter(x=>norm(x.nome)===norm(nome));if(a.length!==1)throw new Error(`${tipo} “${nome}” não encontrado de forma única. Nenhuma meta foi alterada.`);return a[0].id;};
 const itens=[]; const oferta=db.prepare('SELECT 1 AS existe FROM polo_produtos WHERE polo_id=? AND produto_id=?');
 for (const [polo, itensPolo] of Object.entries(dados)) for (const [produto, valor] of Object.entries(itensPolo)) {
   const po=achar(polos,polo,'Polo'), pr=achar(produtos,produto,'Produto');
   if (!oferta.get(po,pr)) throw new Error(`O produto “${produto}” não está habilitado para ${polo}. Nenhuma meta foi alterada.`);
   itens.push({polo,produto,po,pr,valor});
 }
 if(itens.length!==35 || itens.reduce((a,x)=>a+x.valor,0)!==1599)throw new Error('Os números da planilha não passaram na conferência. Nenhuma meta foi alterada.');
 const diretorio=path.join(__dirname,'dados','backups');fs.mkdirSync(diretorio,{recursive:true});
 const nome='antes-metas-51-2027-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db';
 const backup=path.join(diretorio,nome);db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
 db.exec('BEGIN IMMEDIATE');
 try {
  const gravar=db.prepare('INSERT INTO metas(ciclo_id,polo_id,produto_id,quantidade) VALUES(?,?,?,?) ON CONFLICT(ciclo_id,polo_id,produto_id) DO UPDATE SET quantidade=excluded.quantidade');
  const obter=db.prepare('SELECT quantidade FROM metas WHERE ciclo_id=? AND polo_id=? AND produto_id=?');
  for (const x of itens) gravar.run(ciclo[0].id,x.po,x.pr,x.valor);
  for (const x of itens) if(obter.get(ciclo[0].id,x.po,x.pr)?.quantidade!==x.valor) throw new Error('A conferência após gravação falhou.');
  db.exec('COMMIT');
 } catch(e) { db.exec('ROLLBACK'); throw e; }
 console.log('CONCLUÍDO — '+ciclo[0].nome);
 console.log('35 metas informadas foram salvas. Soma das metas da imagem: 1.599.');
 console.log('Células em branco e matrículas foram preservadas.');
 console.log('Backup criado em: '+backup);
 db.close();
} catch(e) { try { if(db) db.close(); } catch(_) {} console.error('ERRO: '+e.message);process.exitCode=1; }
