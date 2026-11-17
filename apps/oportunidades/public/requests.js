/* Leituras deduplicadas, substituição de consultas antigas e limite de espera. */
(function(root){
  'use strict';
  function create({fetcher=(...args)=>fetch(...args),onUnauthorized=()=>{},timeoutMs=20000}={}){
    const pending=new Map();
    const cancelReads=()=>{for(const item of pending.values()){item.superseded=true;item.controller.abort();}pending.clear();};
    function json(url,options={}){
      const read=String(options.method||'GET').toUpperCase()==='GET';
      const key=new URL(url,'http://local').pathname.replace(/\/\d+(?=\/|$)/g,'/:id');
      if(read&&pending.get(key)?.url===url)return pending.get(key).promise;
      if(read&&pending.has(key)){const old=pending.get(key);old.superseded=true;old.controller.abort();}
      const item={url,controller:read?new AbortController():null,superseded:false,timedOut:false};
      const timer=read?setTimeout(()=>{item.timedOut=true;item.controller.abort();},timeoutMs):null;
      item.promise=(async()=>{
        try{
          const res=await fetcher(url,{credentials:'same-origin',cache:'no-store',...options,...(read?{signal:item.controller.signal}:{}),headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
          const data=await res.json().catch(error=>{if(error.name==='AbortError')throw error;return {};});
          if(item.superseded)throw new DOMException('Consulta substituída.','AbortError');
          if(res.status===401){onUnauthorized();throw new Error('Sessão expirada.');}
          if(!res.ok)throw new Error(data.erro||data.error||`Falha na consulta (${res.status}).`);
          if(!read)cancelReads();
          return data;
        }catch(error){
          if(item.timedOut){const timeout=new Error('A consulta excedeu 20 segundos. Tente novamente ou reduza os filtros.');timeout.name='TimeoutError';throw timeout;}
          throw error;
        }finally{if(timer)clearTimeout(timer);if(pending.get(key)===item)pending.delete(key);}
      })();
      if(read)pending.set(key,item);
      return item.promise;
    }
    return {json,cancelReads};
  }
  if(typeof module==='object'&&module.exports)module.exports={create};else root.BalbinoRequests={create};
})(typeof globalThis==='undefined'?this:globalThis);
