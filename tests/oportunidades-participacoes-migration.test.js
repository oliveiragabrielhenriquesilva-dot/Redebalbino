'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
test('migração preserva vínculos antigos e aceita a mesma inscrição em duas carteiras',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE ma_op_acoes(id INTEGER PRIMARY KEY,ciclo_id INTEGER,nome TEXT,inicio TEXT,hash TEXT,pendencias TEXT);
 CREATE TABLE ma_oportunidades(id INTEGER PRIMARY KEY);CREATE TABLE tutores(id INTEGER PRIMARY KEY);
 CREATE TABLE ma_oportunidade_atendimentos(id INTEGER PRIMARY KEY);
 CREATE TABLE ma_op_acao_leads(acao_id INTEGER,oportunidade_id INTEGER,tutor_id INTEGER,aba TEXT,ra_inicial TEXT,PRIMARY KEY(acao_id,oportunidade_id));
 INSERT INTO ma_op_acoes VALUES(1,1,'Legado','2026-11-17','x','[]');INSERT INTO ma_oportunidades VALUES(1);INSERT INTO tutores VALUES(1),(2);
 INSERT INTO ma_op_acao_leads VALUES(1,1,1,'Bia','sem_ra');`);
 const all=(q,...p)=>db.prepare(q).all(...p),get=(q,...p)=>db.prepare(q).get(...p),run=(q,...p)=>db.prepare(q).run(...p);
 const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 require('../apps/matriculas/oportunidades-acoes')({db,all,get,run,tx});
 const old=get('SELECT * FROM ma_op_acao_leads');assert.strictEqual(old.aba,'Bia');assert.strictEqual(old.tutor_id,1);assert.strictEqual(old.ra_inicial,'sem_ra');assert.ok(old.id);
 run('INSERT INTO ma_op_acao_leads(acao_id,oportunidade_id,tutor_id,aba,linha_fonte,ra_inicial) VALUES(1,1,2,\'Tainara\',2,\'sem_ra\')');
 assert.strictEqual(get('SELECT count(*) n FROM ma_op_acao_leads').n,2);
 assert.ok(all('PRAGMA table_info(ma_oportunidade_atendimentos)').some(c=>c.name==='acao_lead_id'));
 }finally{db.close();}
});
