export function digits(value=''){return String(value||'').replace(/\D/g,'')}
export function whatsappConversationDestination(conversation,contact,messages=[]){
  const recent=[...(messages||[])].reverse().find(m=>m&&(m.remoteJid||m.remoteJidAlt));
  const phone=digits(contact?.phone||'');
  return conversation?.peerJid||recent?.remoteJid||conversation?.peerJidAlt||recent?.remoteJidAlt||(phone?`${phone}@s.whatsapp.net`:null)||contact?.whatsappJidAlt||contact?.whatsappJid||contact?.phone||'';
}
