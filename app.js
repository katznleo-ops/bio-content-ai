// EduCator browser app
(() => {
  'use strict';
  const API_URL = window.EDUCATOR_API_URL || '/api/solve';
  const STORAGE_KEY = 'educator.conversations.v2';
  const ACTIVE_KEY = 'educator.activeConversation.v2';
  const TOPICS_KEY = 'educator.topics.v2';
  const DEFAULT_TOPICS = ['General','Math & Numbers','Science & Nature','Writing & Language','History & Society'];
  const $ = (selector) => document.querySelector(selector);
  const els = {welcome:$('#welcome'),app:$('#app'),dashboard:$('#dashboard'),chatView:$('#chatView'),messages:$('#messages'),history:$('#historyList'),emptyHistory:$('#emptyHistory'),historySearch:$('#historySearch'),dashboardForm:$('#dashboardForm'),dashboardInput:$('#dashboardInput'),dashboardTopic:$('#dashboardTopic'),chatForm:$('#chatForm'),chatInput:$('#chatInput'),chatTopic:$('#chatTopic'),newChat:$('#newChat'),title:$('#topbarTitle'),toast:$('#toast'),sidebar:$('#sidebar'),scrim:$('#sidebarScrim'),topicList:$('#topicList')};
  let conversations = load(STORAGE_KEY, []);
  let activeId = localStorage.getItem(ACTIVE_KEY) || '';
  let topics = load(TOPICS_KEY, DEFAULT_TOPICS);
  let activeTopic = 'All notebooks';
  let busy = false;

  function load(key, fallback) { try { const value=JSON.parse(localStorage.getItem(key)||'null'); return Array.isArray(value)&&value.length ? value : fallback; } catch { return fallback; } }
  function persist() { conversations.sort((a,b)=>b.updatedAt-a.updatedAt); localStorage.setItem(STORAGE_KEY,JSON.stringify(conversations.slice(0,60))); if(activeId)localStorage.setItem(ACTIVE_KEY,activeId);else localStorage.removeItem(ACTIVE_KEY); localStorage.setItem(TOPICS_KEY,JSON.stringify(topics)); renderTopics(); renderHistory(); }
  function makeId(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`}
  function currentChat(){return conversations.find(chat=>chat.id===activeId)}
  function titleFrom(text){const clean=text.replace(/\s+/g,' ').trim();return clean.length>42?clean.slice(0,40).trimEnd()+'…':clean||'New conversation'}
  function escapeHtml(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  function renderTopics(){
    els.topicList.replaceChildren();
    for(const name of ['All notebooks',...topics]){const button=document.createElement('button');button.type='button';button.className=`topic-filter${activeTopic===name?' active':''}`;button.textContent=name;button.addEventListener('click',()=>{activeTopic=name;renderTopics();renderHistory()});els.topicList.append(button)}
  }
  function renderHistory(){
    const query=els.historySearch.value.trim().toLowerCase();
    const items=conversations.filter(chat=>(activeTopic==='All notebooks'||chat.topic===activeTopic)&&chat.title.toLowerCase().includes(query));
    els.history.replaceChildren();
    for(const chat of items){const row=document.createElement('div');row.className=`history-item${chat.id===activeId?' active':''}`;row.innerHTML=`<span class="history-item-title"></span><span class="history-item-actions"><button type="button" class="history-action rename" title="Rename">✎</button><button type="button" class="history-action delete" title="Delete">×</button></span>`;row.querySelector('.history-item-title').textContent=chat.title;row.addEventListener('click',()=>selectConversation(chat.id));row.querySelector('.rename').addEventListener('click',e=>{e.stopPropagation();const name=prompt('Rename conversation',chat.title);if(name?.trim()){chat.title=name.trim();chat.updatedAt=Date.now();persist()}});row.querySelector('.delete').addEventListener('click',e=>{e.stopPropagation();if(confirm(`Delete “${chat.title}”?`)){conversations=conversations.filter(c=>c.id!==chat.id);if(activeId===chat.id){activeId='';showDashboard()}persist()}});els.history.append(row)}
    els.emptyHistory.hidden=items.length>0;els.emptyHistory.textContent=query?'No matching conversations.':'No conversations in this notebook.';
  }
  function showDashboard(){els.dashboard.hidden=false;els.chatView.hidden=true;els.title.textContent='Your learning space';renderHistory()}
  function renderChat(){const chat=currentChat();if(!chat)return showDashboard();els.title.textContent=chat.title;els.messages.replaceChildren();chat.messages.forEach(message=>appendMessage(message.role,message.text,false));els.messages.scrollTop=els.messages.scrollHeight}
  function selectConversation(id){if(!conversations.some(chat=>chat.id===id))return;activeId=id;persist();els.dashboard.hidden=true;els.chatView.hidden=false;renderChat();closeSidebar()}
  function newConversation(){activeId='';showDashboard();closeSidebar();els.dashboardInput.focus({preventScroll:true})}

  function startConversation(text,topic='General'){const chat={id:makeId(),title:titleFrom(text),topic,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};conversations.unshift(chat);activeId=chat.id;persist();return chat}
  function appendMessage(role,text,withActions=true){const row=document.createElement('article');row.className=`message-row ${role}`;row.innerHTML=`<div class="message-avatar">${role==='assistant'?'E':'Y'}</div><div class="message-content"><div class="message-author">${role==='assistant'?'EduCator':'You'}</div><div class="message-bubble"></div>${role==='assistant'&&withActions?'<div class="message-actions"><button type="button">Copy</button></div>':''}</div>`;row.querySelector('.message-bubble').innerHTML=`<p>${escapeHtml(text).replace(/\n/g,'<br>')}</p>`;if(row.querySelector('button'))row.querySelector('button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text);showToast('Answer copied')}catch{showToast('Could not access the clipboard')}});els.messages.append(row);return row}

  async function sendMessage(rawText){const text=rawText.trim();if(!text||busy)return;let chat=currentChat();if(!chat){chat=startConversation(text,els.chatTopic.value||els.dashboardTopic.value||'General');showChat()}chat.messages.push({role:'user',text});chat.updatedAt=Date.now();appendMessage('user',text,false);persist();busy=true;const typing=appendMessage('assistant','',false);typing.classList.add('typing-row');typing.querySelector('.message-bubble').innerHTML='<span class="typing-indicator"><i></i><i></i><i></i></span>';try{const history=chat.messages.map(message=>({role:message.role==='assistant'?'model':'user',text:message.text}));const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Server error ${response.status}`);if(!data.answer?.trim())throw new Error('No answer came back');typing.remove();chat.messages.push({role:'assistant',text:data.answer.trim()});chat.updatedAt=Date.now();appendMessage('assistant',data.answer.trim());persist()}catch(error){typing.remove();appendMessage('assistant',error.message||'Could not reach EduCator.') }finally{busy=false;els.chatInput.value='';els.messages.scrollTop=els.messages.scrollHeight}}

  function showChat(){els.dashboard.hidden=true;els.chatView.hidden=false;const chat=currentChat();if(chat){els.chatTopic.value=topics.includes(chat.topic)?chat.topic:'General'}renderChat()}
  function enterApp(){els.welcome.hidden=true;els.app.hidden=false;activeId=currentChat()?.messages.length?activeId:'';activeId?showChat():showDashboard()}
  function goHome(){els.app.hidden=true;els.welcome.hidden=false;closeSidebar();window.scrollTo({top:0,behavior:'smooth'})}
  function openSidebar(){els.sidebar.classList.add('open');els.scrim.classList.add('visible')}
  function closeSidebar(){els.sidebar.classList.remove('open');els.scrim.classList.remove('visible')}
  function showToast(message){els.toast.textContent=message;els.toast.classList.add('show');setTimeout(()=>els.toast.classList.remove('show'),2200)}
  function syncTopicSelects(){const topicOptions=topics.map(topic=>`<option>${escapeHtml(topic)}</option>`).join('');els.chatTopic.innerHTML=topicOptions}

  $('#startLearning').addEventListener('click',enterApp);$('#enterFromNav').addEventListener('click',enterApp);$('#parallaxStart').addEventListener('click',enterApp);$('#homeButton').addEventListener('click',goHome);els.newChat.addEventListener('click',newConversation);$('#openSidebar').addEventListener('click',openSidebar);$('#closeSidebar').addEventListener('click',closeSidebar);els.scrim.addEventListener('click',closeSidebar);
  $('#clearHistory').addEventListener('click',()=>{if(conversations.length&&confirm('Delete all saved conversations?')){conversations=[];activeId='';persist();showDashboard()}});
  $('#addTopic').addEventListener('click',()=>{const name=prompt('Notebook name');if(name?.trim()){const clean=name.trim();if(!topics.includes(clean))topics.push(clean);persist();syncTopicSelects()}});
  els.historySearch.addEventListener('input',renderHistory);
  document.querySelectorAll('[data-topic]').forEach(card=>card.addEventListener('click',()=>{const topic=card.dataset.topic;els.dashboardTopic.value=topic;if(!topics.includes(topic)){topics.push(topic);persist()}els.dashboardInput.value=card.dataset.prompt;els.dashboardInput.focus()}));
  els.dashboardForm.addEventListener('submit',event=>{event.preventDefault();const text=els.dashboardInput.value.trim();if(!text)return;const topic=els.dashboardTopic.value||'General';activeId='';enterApp();els.dashboardInput.value='';sendMessage(text).then(()=>{const chat=currentChat();if(chat){chat.topic=topic;activeTopic=topic;persist()}})});
  els.chatForm.addEventListener('submit',event=>{event.preventEvent?.();event.preventDefault();const text=els.chatInput.value.trim();if(!text)return;els.chatInput.value='';sendMessage(text)});
  els.chatTopic.addEventListener('change',()=>{const chat=currentChat();if(chat){chat.topic=els.chatTopic.value;chat.updatedAt=Date.now();activeTopic=chat.topic;persist()}});
  syncTopicSelects();renderTopics();renderHistory();
})();
