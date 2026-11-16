'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
test('snapshot do Conecta preserva hash, cursos e argumentários recebidos',()=>{
 const dir=path.join(__dirname,'../apps/conecta/data'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 const data=zlib.gunzipSync(Buffer.from(m.parts.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join(''),'base64'));
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),m.sha256);
 const parsed=JSON.parse(data);assert.equal(parsed.courses.length,119);assert.equal(parsed.courses.filter(c=>c.argumentario).length,115);
 assert.equal(new Set(parsed.courses.map(c=>c.id)).size,119);
});
