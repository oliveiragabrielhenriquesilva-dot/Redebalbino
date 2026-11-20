'use strict';
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));

chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type==='BALBINO_TAB_ID'&&s.id===chrome.runtime.id){reply({tabId:s.tab?.id});}});
