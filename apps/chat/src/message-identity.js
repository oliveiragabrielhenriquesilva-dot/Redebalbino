export function messageInstanceId(db,message){
  if(!message)return null;
  if(message.instanceId)return String(message.instanceId);
  const c=(db?.conversations||[]).find(x=>x.id===message.conversationId);
  return c?.instanceId?String(c.instanceId):null;
}
export function externalMessageKey(instanceId,externalId){
  if(!externalId)return'';
  return `${String(instanceId||'')}::${String(externalId)}`;
}
export function messageBelongsToInstance(db,message,instanceId){
  if(!instanceId)return true;
  return messageInstanceId(db,message)===String(instanceId);
}
export function findMessageForInstance(db,externalId,instanceId,predicate=null){
  if(!externalId)return null;
  const rows=(db?.messages||[]).filter(m=>m.externalId===externalId&&messageBelongsToInstance(db,m,instanceId));
  return (predicate?rows.find(predicate):rows[0])||null;
}
export function messagesForExternalIdInstance(db,externalId,instanceId){
  if(!externalId)return[];
  return (db?.messages||[]).filter(m=>m.externalId===externalId&&messageBelongsToInstance(db,m,instanceId));
}
