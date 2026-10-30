'use strict';
// Comparativos, qualidade e fechamentos imutáveis. Sem bibliotecas externas.
module.exports = function(ctx) {
  const {db,all,get,run,falha,enviarJson,lerCorpo,ehAdmin,poloRestrito,dataRef,addDias,inicioSemana,painel,paginaTutor,bootstrap,registrar,tx,validarPeriodo,hojeISO,mascaraCpf} = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS fechamentos (
    id INTEGER PRIMARY KEY, ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
    polo_id INTEGER REFERENCES polos(id), ref TEXT NOT NULL, nome TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT NOT NULL,
    dados TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_fechamentos_ciclo ON fechamentos(ciclo_id,ref);`);
  function qualidade(q,u) {
    const ciclo=Number(q.ciclo), pid=poloRestrito(u)||Number(q.polo)||0;
    if(!get('SELECT id FROM ciclos WHERE id=?',ciclo)) falha(400,'Processo inválido');
    const p=pid?'AND po.id=?':'', args=pid?[ciclo,pid]:[ciclo], itens=[];
    if(!get('SELECT 1 FROM spaces WHERE ciclo_id=?',ciclo)) itens.push({nivel:'info',tipo:'spaces',mensagem:'Aguardando definição dos Spaces. O ritmo geral permanece pendente; prazos próprios continuam válidos.'});
    const ps=all(`SELECT po.id,po.nome,COALESCE(SUM(me.quantidade),0) meta FROM polos po LEFT JOIN metas me ON me.polo_id=po.id AND me.ciclo_id=? WHERE po.ativo=1 ${p} GROUP BY po.id`,...args);
    for(const po of ps){
      const equipe=all('SELECT t.id,t.nome FROM tutor_polos tp JOIN tutores t ON t.id=tp.tutor_id WHERE tp.polo_id=? AND t.ativo=1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id)',po.id);
      const individuais=all('SELECT tutor_id,quantidade FROM metas_tutor WHERE ciclo_id=? AND polo_id=?',ciclo,po.id);
      const soma=individuais.reduce((n,x)=>n+x.quantidade,0);
      const add=(tipo,mensagem)=>itens.push({nivel:'warn',tipo,polo_id:po.id,polo:po.nome,mensagem:po.nome+': '+mensagem});
      if(!po.meta)add('meta_polo','sem meta de matrículas cadastrada.');
      if(po.meta&&!equipe.length)add('equipe','meta cadastrada, mas nenhum tutor ativo vinculado.');
      if(individuais.length){
        const ativos=individuais.filter(x=>equipe.some(t=>t.id===x.tutor_id));
        const falta=equipe.filter(t=>!ativos.some(x=>x.tutor_id===t.id&&x.quantidade>0));
        if(soma!==po.meta)add('soma_metas',`soma das metas individuais (${soma}) difere da meta do polo (${po.meta}).`);
        if(falta.length)add('tutor_sem_meta','tutores sem meta individual: '+falta.map(t=>t.nome).join(', ')+'.');
        if(ativos.length!==individuais.length)add('meta_inativo','há metas individuais de tutores inativos ou sem vínculo atual.');
      }
    }
    const cond=pid?'AND m.polo_id=?':'';
    const mats=all(`SELECT m.id,m.data,m.aluno,m.cpf,m.valor,m.tutor_id,m.polo_id,m.produto_id,COALESCE(m.tutor_polo_id,m.polo_id) credito FROM matriculas m WHERE m.ciclo_id=? ${cond}`,...args);
    const cont=(tipo,mensagem,rs)=>{if(rs.length)itens.push({nivel:'warn',tipo,mensagem:mensagem+': '+rs.length+' registro(s).',quantidade:rs.length,ids:rs.map(x=>x.id)});};
    cont('aluno','Nome do aluno não informado',mats.filter(x=>!x.aluno));
    cont('cpf','CPF não informado',mats.filter(x=>!x.cpf));
    cont('valor','Mensalidade zerada',mats.filter(x=>x.valor<=0));
    const vinculos=new Set(all('SELECT tutor_id,polo_id FROM tutor_polos').map(x=>x.tutor_id+'-'+x.polo_id));
    cont('vinculo','Crédito de tutor sem vínculo atual',mats.filter(x=>!vinculos.has(x.tutor_id+'-'+x.credito)));
    const cpf=new Set(),duplicados=[];for(const x of mats){if(!x.cpf)continue;const k=x.cpf+'-'+x.produto_id;if(cpf.has(k))duplicados.push(x);cpf.add(k);}cont('duplicidade','CPF repetido no mesmo produto/processo',duplicados);
    const origens=Object.fromEntries(all('SELECT id,polo_origem_id FROM tutores').map(t=>[t.id,t.polo_origem_id]));
    const divergentes=mats.filter(x=>origens[x.tutor_id]&&origens[x.tutor_id]!==x.credito&&!get('SELECT 1 FROM credito_excecoes WHERE matricula_id=? AND credito_novo=?',x.id,x.credito));
    cont('credito_origem','Crédito diferente da origem atual sem exceção registrada (pode ser histórico anterior a transferência; conferir, sem alterar automaticamente)',divergentes);
    const semTicket=all(`SELECT me.polo_id,po.nome polo,me.produto_id,pr.nome produto,me.quantidade FROM metas me JOIN polos po ON po.id=me.polo_id JOIN produtos pr ON pr.id=me.produto_id WHERE me.ciclo_id=? AND me.quantidade>0 ${pid?'AND me.polo_id=?':''} AND NOT EXISTS(SELECT 1 FROM metas_rpv tk WHERE tk.ciclo_id=me.ciclo_id AND tk.produto_id=me.produto_id AND tk.polo_id IN(0,me.polo_id))`,...args);
    for(const po of ps){const faltam=semTicket.filter(x=>x.polo_id===po.id);if(faltam.length)itens.push({nivel:'warn',tipo:'ticket_incompleto',polo_id:po.id,polo:po.nome,quantidade:faltam.reduce((n,x)=>n+x.quantidade,0),mensagem:po.nome+': meta de ticket não configurada para '+faltam.map(x=>x.produto+' ('+x.quantidade+')').join(', ')+'. Meta de RPV incompleta.'});}
    const cc=get('SELECT data_inicio,data_fim FROM ciclos WHERE id=?',ciclo);
    cont('fora_periodo','Matrícula fora do período do processo',mats.filter(x=>(cc.data_inicio&&x.data<cc.data_inicio)||(cc.data_fim&&x.data>cc.data_fim)));
    return {itens,avisos:itens.filter(x=>x.nivel==='warn').length,ref:dataRef(q)};
  }
  function comparativo(q,u){
    validarPeriodo(q);const ciclo=Number(q.ciclo),pid=poloRestrito(u)||Number(q.polo)||0,ref=dataRef(q);
    if(!get('SELECT id FROM ciclos WHERE id=?',ciclo))falha(400,'Processo inválido');
    const ate=q.ate||ref,de=q.de||inicioSemana(ate);
    if(de>ate)falha(400,'Período inválido');
    const n=Math.round((Date.parse(ate)-Date.parse(de))/864e5)+1;
    if(n>3660)falha(400,'Selecione um período de até dez anos');
    const anteriorAte=addDias(de,-1),anteriorDe=addDias(de,-n);
    const ps=all(`SELECT id,nome FROM polos WHERE (ativo=1 OR id IN(SELECT polo_id FROM matriculas WHERE ciclo_id=?)) ${pid?'AND id=?':''} ORDER BY ordem,nome`,ciclo,...(pid?[pid]:[]));
    const filtroProduto=Number(q.produto)||0;
    const rows=all(`SELECT m.polo_id,m.tutor_id,COALESCE(m.tutor_polo_id,m.polo_id) credito,m.data,m.valor FROM matriculas m WHERE ciclo_id=? AND data BETWEEN ? AND ? ${filtroProduto?'AND produto_id=?':''} ${pid?'AND (polo_id=? OR COALESCE(tutor_polo_id,polo_id)=?)':''}`,ciclo,anteriorDe,ate,...(filtroProduto?[filtroProduto]:[]),...(pid?[pid,pid]:[]));
    const valores=rs=>{const atual=rs.filter(x=>x.data>=de),ant=rs.filter(x=>x.data<de),rpv=atual.reduce((n,x)=>n+x.valor,0),rpvAnt=ant.reduce((n,x)=>n+x.valor,0);return {atual:atual.length,anterior:ant.length,variacao:atual.length-ant.length,percentual:ant.length?(atual.length-ant.length)/ant.length*100:null,rpv,rpv_anterior:rpvAnt,ticket:atual.length?rpv/atual.length:null};};
    const polos=ps.map(p=>({...p,...valores(rows.filter(x=>x.polo_id===p.id))}));
    const tutores=all(`SELECT t.id,t.nome FROM tutores t WHERE t.ativo=1 OR t.id IN(SELECT tutor_id FROM matriculas WHERE ciclo_id=?) ORDER BY t.nome`,ciclo).map(t=>{const rs=rows.filter(x=>x.tutor_id===t.id&&(!pid||x.credito===pid));const ids=[...new Set(rs.map(x=>x.credito))];return {...t,polos:ids.map(id=>(get('SELECT nome FROM polos WHERE id=?',id)||{}).nome),...valores(rs)};}).filter(t=>t.atual||t.anterior||get(`SELECT 1 FROM tutor_polos WHERE tutor_id=? ${pid?'AND polo_id=?':''}`,t.id,...(pid?[pid]:[])));
    return {de,ate,anterior_de:anteriorDe,anterior_ate:anteriorAte,dias:n,ref,produto:filtroProduto,totais:valores(rows.filter(x=>!pid||x.polo_id===pid)),polos,tutores,nota:'Comparação de períodos consecutivos com igual número de dias corridos. Somente matrículas lançadas; Sede/Digital não possui identificação diária individual. Polos usam o destino da matrícula; tutores usam o polo de crédito.'};
  }
  function congelarAnalitico(ciclo,pid,ref){
    const pp=pid?[pid,pid]:[],cond=pid?'AND (m.polo_id=? OR COALESCE(m.tutor_polo_id,m.polo_id)=?)':'';
    const matriculas=all(`SELECT m.*,po.nome polo_destino,tu.nome tutor,COALESCE(m.tutor_polo_id,m.polo_id) polo_credito_id,
      (SELECT nome FROM polos WHERE id=COALESCE(m.tutor_polo_id,m.polo_id)) polo_credito,pr.nome produto,ca.nome categoria,og.nome origem,pr.meta_ate,
      CASE WHEN pr.meta_ate IS NULL OR pr.meta_ate='' OR m.data<=pr.meta_ate THEN 1 ELSE 0 END conta_meta
      FROM matriculas m JOIN polos po ON po.id=m.polo_id JOIN tutores tu ON tu.id=m.tutor_id JOIN produtos pr ON pr.id=m.produto_id JOIN categorias ca ON ca.id=pr.categoria_id JOIN origens og ON og.id=m.origem_id
      WHERE m.ciclo_id=? AND m.data<=? ${cond} ORDER BY m.data,m.id`,ciclo,ref,...pp);
    const filtro=pid?'AND polo_id=?':'',param=pid?[ciclo,pid]:[ciclo];
    const excecoes=all(`SELECT e.* FROM credito_excecoes e JOIN matriculas m ON m.id=e.matricula_id WHERE m.ciclo_id=? AND m.data<=? ${cond} ORDER BY e.id`,ciclo,ref,...pp);
    return {matriculas,excecoes_credito:excecoes,metas:all(`SELECT * FROM metas WHERE ciclo_id=? ${filtro}`,...param),
      metas_tutor:all(`SELECT * FROM metas_tutor WHERE ciclo_id=? ${filtro}`,...param),
      metas_rpv:all(`SELECT * FROM metas_rpv WHERE ciclo_id=? ${pid?'AND polo_id IN(0,?)':''}`,...param),
      metas_semanais:all(`SELECT * FROM metas_ritmo_semanal WHERE ciclo_id=? ${filtro}`,...param),
      metas_diarias:all(`SELECT * FROM metas_ritmo_diario WHERE ciclo_id=? ${filtro}`,...param)};
  }
  async function rotas(req,res,p,m,q,u){
    if(p==='/api/qualidade'&&m==='GET'){enviarJson(res,200,qualidade(q,u));return true;}
    if(p==='/api/comparativo'&&m==='GET'){enviarJson(res,200,comparativo(q,u));return true;}
    if(p==='/api/fechamentos'&&m==='GET'){
      const pid=poloRestrito(u)||Number(q.polo)||0;
      enviarJson(res,200,all(`SELECT id,ciclo_id,polo_id,ref,nome,criado_em,criado_por FROM fechamentos WHERE ciclo_id=? ${pid?'AND (polo_id IS NULL OR polo_id=?)':''} ORDER BY ref DESC,id DESC`,Number(q.ciclo),...(pid?[pid]:[])));return true;
    }
    if(p==='/api/fechamentos'&&m==='POST'){
      if(!ehAdmin(u))falha(403,'Apenas administradores');
      const c=await lerCorpo(req),ref=dataRef({ref:c.ref}),ciclo=Number(c.ciclo),pid=Number(c.polo)||0;
      if(ref>hojeISO())falha(400,'Não é possível fechar uma posição futura');
      if(!get('SELECT id FROM ciclos WHERE id=?',ciclo)||(pid&&!get('SELECT id FROM polos WHERE id=?',pid)))falha(400,'Processo ou polo inválido');
      const nome=String(c.nome||'Fechamento '+ref).trim().slice(0,120);
      const id=tx(()=>{
        const b=bootstrap(u),polos=b.polos.filter(x=>!pid||x.id===pid),paineis={};
        if(!pid)paineis.rede=painel({ciclo,ref,historico:'1'},u);
        for(const p of polos)paineis[p.id]=painel({ciclo,polo:p.id,ref,historico:'1'},u);
        const chaves=['nome_rede','nome_sistema','logo','contagem_dias','lancamento','inicio_semana','dias_meta_semana','incluir_sede_digital','dias_min_projecao','exigir_cpf','exigir_aluno'];
        const padroes={contagem_dias:'seg-sex',lancamento:'mesmo_dia',inicio_semana:'2',dias_meta_semana:'1,2,3,4,5,6',incluir_sede_digital:'1',exigir_cpf:'0',exigir_aluno:'0'};
        const config={...padroes,...Object.fromEntries(chaves.filter(k=>k in b.config).map(k=>[k,b.config[k]]))};
        const dados={versao:28,formato:2,modalidade:'analitico',ref,ciclo,polo_id:pid||null,metadados:{config,ciclos:b.ciclos,produtos:b.produtos,categorias:b.categorias,spaces:b.spaces,feriados:b.feriados,polos:b.polos,tutores:b.tutores},paineis,analitico:congelarAnalitico(ciclo,pid,ref)};
        return Number(run('INSERT INTO fechamentos(ciclo_id,polo_id,ref,nome,criado_por,dados) VALUES(?,?,?,?,?,?)',ciclo,pid||null,ref,nome,u.login,JSON.stringify(dados)).lastInsertRowid);
      });
      registrar(u,'criou fechamento imutável',`#${id} ${nome}`);enviarJson(res,200,{id});return true;
    }
    const mm=p.match(/^\/api\/fechamentos\/(\d+)$/);
    if(mm&&m==='GET'){
      const f=get('SELECT * FROM fechamentos WHERE id=?',Number(mm[1]));if(!f)falha(404,'Fechamento não encontrado');
      const pid=poloRestrito(u)||Number(q.polo)||0,d=JSON.parse(f.dados);
      if(pid){
        if(!d.paineis[pid])falha(404,'Polo não encontrado neste fechamento');
        d.paineis={[pid]:d.paineis[pid]};d.polo_id=pid;
        d.metadados.polos=d.metadados.polos.filter(x=>x.id===pid);
        d.metadados.tutores=d.metadados.tutores.filter(t=>t.polos.includes(pid)).map(t=>({...t,polo_origem_id:t.polo_origem_id===pid?pid:null,polos:[pid]}));
        d.metadados.feriados=d.metadados.feriados.filter(x=>!x.polo_id||x.polo_id===pid);
        if(d.analitico){const a=d.analitico;a.matriculas=a.matriculas.filter(x=>x.polo_id===pid||x.polo_credito_id===pid);
          const ids=new Set(a.matriculas.map(x=>x.id));
          a.excecoes_credito=a.excecoes_credito.filter(x=>ids.has(x.matricula_id));
          for(const k of ['metas','metas_tutor','metas_semanais','metas_diarias'])a[k]=a[k].filter(x=>x.polo_id===pid);
          a.metas_rpv=a.metas_rpv.filter(x=>x.polo_id===0||x.polo_id===pid);
        }
      }
      if(poloRestrito(u)&&d.analitico)for(const row of d.analitico.matriculas)row.cpf=mascaraCpf(row.cpf);

      delete f.dados;enviarJson(res,200,{...f,dados:d});return true;
    }
    return false;
  }
  return {rotas,qualidade,comparativo};
};
