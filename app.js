// EduCator browser app. Conversations and notebook names are stored locally on this device.
(() => {
  'use strict';
  const API_URL = window.EDUCATOR_API_URL || '/api/solve';
  const STORAGE_KEY = 'educator.conversations.v2';
  const ACTIVE_KEY = 'educator.activeConversation.v2';
  const TOPICS_KEY = 'educator.topics.v2';
  const FONT_KEY = 'educator.fontTheme.v1';
  const FONT_THEMES = { sans: "'DM Sans',system-ui,sans-serif", rounded: "'Nunito',system-ui,sans-serif", serif: "'Lora',Georgia,serif", readable: "'Atkinson Hyperlegible',Arial,sans-serif" };
  const $ = (selector) => document.querySelector(selector);
  const els = {
    welcome:$('#welcome'),app:$('#app'),dashboard:$('#dashboard'),chatView:$('#chatView'),messages:$('#messages'),history:$('#historyList'),emptyHistory:$('#emptyHistory'),historySearch:$('#historySearch'),dashboardForm:$('#dashboardForm'),dashboardInput:$('#dashboardInput'),dashboardTopic:$('#dashboardTopic'),chatForm:$('#chatForm'),chatInput:$('#chatInput'),chatTopic:$('#chatTopic'),fontTheme:$('#fontTheme'),newChat:$('#newChat'),title:$('#topbarTitle'),toast:$('#toast'),sidebar:$('#sidebar'),scrim:$('#sidebarScrim'),topicList:$('#topicList')
  };
  let conversations = readArray(STORAGE_KEY);
  let activeId = localStorage.getItem(ACTIVE_KEY) || '';
  let topics = readArray(TOPICS_KEY).map(String).filter((topic,index,array) => topic.trim() && array.indexOf(topic) === index);
  let activeTopic = '';
  let busy = false;
  let toastTimer;

  function readArray(key) { try { const value=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(value)?value:[]; } catch { return []; } }
  function persist() {
    conversations.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    conversations=conversations.slice(0,60);
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(conversations)); if(activeId)localStorage.setItem(ACTIVE_KEY,activeId);else localStorage.removeItem(ACTIVE_KEY); localStorage.setItem(TOPICS_KEY,JSON.stringify(topics)); }
    catch { showToast('Browser storage is full. Remove older chats to save this one.'); }
    renderTopics(); renderHistory(); syncNotebookSelects();
  }
  function makeId(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;}
  function currentChat(){return conversations.find(chat=>chat.id===activeId);}
  function titleFrom(text){const clean=text.replace(/\s+/g,' ').trim();return clean.length>42?`${clean.slice(0,40).trimEnd()}…`:clean||'New conversation';}
  function escapeHtml(text){return String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

  function renderTopics(){
    els.topicList.replaceChildren();
    const all=document.createElement('button');all.type='button';all.className=`topic-filter${activeTopic===''?' active':''}`;all.textContent='All conversations';all.addEventListener('click',()=>{activeTopic='';renderTopics();renderHistory()});els.topicList.append(all);
    for(const name of topics){
      const row=document.createElement('div');row.className='notebook-row';
      const filter=document.createElement('button');filter.type='button';filter.className=`topic-filter${activeTopic===name?' active':''}`;filter.textContent=name;filter.title=`Show ${name} conversations`;filter.addEventListener('click',()=>{activeTopic=name;renderTopics();renderHistory()});
      const actions=document.createElement('div');actions.className='notebook-actions';
      const rename=document.createElement('button');rename.type='button';rename.className='notebook-action';rename.textContent='✎';rename.title=`Rename ${name}`;rename.setAttribute('aria-label',`Rename notebook ${name}`);rename.addEventListener('click',()=>renameNotebook(name));
      const remove=document.createElement('button');remove.type='button';remove.className='notebook-action delete';remove.textContent='×';remove.title=`Delete ${name}`;remove.setAttribute('aria-label',`Delete notebook ${name}`);remove.addEventListener('click',()=>deleteNotebook(name));
      actions.append(rename,remove);row.append(filter,actions);els.topicList.append(row);
    }
    const empty=document.createElement('p');empty.className='notebook-empty';empty.textContent=topics.length?'':'No notebooks yet. Add one to organize your chats.';els.topicList.append(empty);
  }
  function renderHistory(){
    const query=els.historySearch.value.trim().toLowerCase();
    const items=conversations.filter(chat=>(!activeTopic||chat.topic===activeTopic)&&String(chat.title||'').toLowerCase().includes(query));
    els.history.replaceChildren();
    for(const chat of items){
      const row=document.createElement('div');row.className=`history-item${chat.id===activeId&&!els.chatView.hidden?' active':''}`;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`Open conversation: ${chat.title}`);
      const title=document.createElement('span');title.className='history-item-title';title.textContent=chat.title||'New conversation';
      const actions=document.createElement('span');actions.className='history-item-actions';
      const rename=document.createElement('button');rename.type='button';rename.className='history-action';rename.textContent='✎';rename.title='Rename conversation';rename.setAttribute('aria-label','Rename conversation');rename.addEventListener('click',event=>{event.stopPropagation();const name=prompt('Conversation name',chat.title);if(name?.trim()){chat.title=name.trim();chat.updatedAt=Date.now();persist();renderChat()}});
      const remove=document.createElement('button');remove.type='button';remove.className='history-action delete';remove.textContent='×';remove.title='Delete conversation';remove.setAttribute('aria-label','Delete conversation');remove.addEventListener('click',event=>{event.stopPropagation();if(confirm(`Delete “${chat.title}”?`)){conversations=conversations.filter(item=>item.id!==chat.id);if(activeId===chat.id){activeId='';showDashboard()}persist()}});
      actions.append(rename,remove);row.append(title,actions);row.addEventListener('click',()=>selectConversation(chat.id));row.addEventListener('keydown',event=>{if(event.target===row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectConversation(chat.id)}});els.history.append(row);
    }
    els.emptyHistory.hidden=items.length>0;els.emptyHistory.textContent=query?'No matching conversations.':activeTopic?'No conversations in this notebook yet.':'Your conversations will appear here.';
  }
  function syncNotebookSelects(){
    for(const select of [els.dashboardTopic,els.chatTopic]){
      const previous=select.value;
      select.replaceChildren();
      const none=document.createElement('option');none.value='';none.textContent='No notebook';select.append(none);
      for(const topic of topics){const option=document.createElement('option');option.value=topic;option.textContent=topic;select.append(option)}
      if(topics.includes(previous))select.value=previous;else select.value='';
    }
    const chat=currentChat();if(chat&&topics.includes(chat.topic))els.chatTopic.value=chat.topic;
  }
  function addNotebook(name){const clean=name.trim();if(!clean)return '';if(topics.some(topic=>topic.toLowerCase()===clean.toLowerCase())){showToast('That notebook already exists.');return ''}topics.push(clean);activeTopic=clean;persist();return clean;}
  function renameNotebook(oldName){const name=prompt('Rename notebook',oldName);if(!name?.trim())return;const clean=name.trim();if(topics.some(topic=>topic.toLowerCase()===clean.toLowerCase()&&topic!==oldName)){showToast('A notebook with that name already exists.');return}topics=topics.map(topic=>topic===oldName?clean:topic);conversations.forEach(chat=>{if(chat.topic===oldName)chat.topic=clean});if(activeTopic===oldName)activeTopic=clean;persist();showToast('Notebook renamed.');}
  function deleteNotebook(name){const count=conversations.filter(chat=>chat.topic===name).length;const message=count?`Delete “${name}”? ${count} conversation${count===1?'':'s'} will be moved to No notebook.`:`Delete “${name}”?`;if(!confirm(message))return;topics=topics.filter(topic=>topic!==name);conversations.forEach(chat=>{if(chat.topic===name)chat.topic=''});if(activeTopic===name)activeTopic='';persist();showToast('Notebook deleted. Chats were kept.');}
  function showDashboard(){els.dashboard.hidden=false;els.chatView.hidden=true;els.title.textContent='Your learning space';renderHistory();}
  function renderChat(){const chat=currentChat();if(!chat)return showDashboard();els.title.textContent=chat.title;els.messages.replaceChildren();chat.messages.forEach(message=>appendMessage(message.role,message.text,false));els.messages.scrollTop=els.messages.scrollHeight;syncNotebookSelects();}
  function selectConversation(id){if(!conversations.some(chat=>chat.id===id))return;activeId=id;persist();els.dashboard.hidden=true;els.chatView.hidden=false;renderChat();closeSidebar();}
  function newConversation(){activeId='';showDashboard();closeSidebar();els.dashboardInput.focus({preventScroll:true});}
  function startConversation(text,topic=''){const chat={id:makeId(),title:titleFrom(text),topic,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};conversations.unshift(chat);activeId=chat.id;persist();return chat;}

  function appendMessage(role,text,withActions=true){
    const row=document.createElement('article');row.className=`message-row ${role}`;
    const avatar=document.createElement('div');avatar.className='message-avatar';avatar.textContent=role==='assistant'?'E':'Y';avatar.setAttribute('aria-hidden','true');
    const content=document.createElement('div');content.className='message-content';const author=document.createElement('div');author.className='message-author';author.textContent=role==='assistant'?'EduCator':'You';
    const bubble=document.createElement('div');bubble.className='message-bubble';bubble.innerHTML=`<p>${escapeHtml(text).replace(/\n/g,'<br>')}</p>`;content.append(author,bubble);
    if(role==='assistant'&&withActions){const actions=document.createElement('div');actions.className='message-actions';const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text);showToast('Answer copied.')}catch{showToast('Could not access the clipboard.')}});actions.append(copy);content.append(actions)}
    row.append(avatar,content);els.messages.append(row);return row;
  }
  async function sendMessage(rawText,topicOverride){
    const text=rawText.trim();if(!text||busy)return;
    let chat=currentChat();if(!chat){chat=startConversation(text,topicOverride??els.dashboardTopic.value??'');showChat()}
    if(!chat.messages.length){chat.title=titleFrom(text);if(topicOverride!==undefined)chat.topic=topicOverride}
    chat.messages.push({role:'user',text});chat.updatedAt=Date.now();appendMessage('user',text,false);persist();els.title.textContent=chat.title;
    busy=true;const submit=els.chatForm.querySelector('button[type="submit"]');submit.disabled=true;
    const typing=appendMessage('assistant','',false);typing.classList.add('typing-row');typing.querySelector('.message-bubble').innerHTML='<span class="typing-indicator" aria-label="EduCator is thinking"><i></i><i></i><i></i></span>';
    try{
      const history=chat.messages.slice(-30).map(message=>({role:message.role==='assistant'?'model':'user',text:message.text}));
      const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})});const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||`The service returned an error (${response.status}).`);if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('No answer came back. Please try again.');
      typing.remove();const answer=data.answer.trim();chat.messages.push({role:'assistant',text:answer});chat.updatedAt=Date.now();appendMessage('assistant',answer);persist();
    }catch(error){typing.remove();const message=error instanceof TypeError?'Could not reach the learning service. Check the connection and try again.':error.message;const row=appendMessage('assistant',message,false);const retry=document.createElement('button');retry.type='button';retry.className='retry-button';retry.textContent='Try again';retry.addEventListener('click',()=>{row.remove();sendMessage(text)});row.querySelector('.message-content').append(retry)}
    finally{busy=false;submit.disabled=false;els.messages.scrollTop=els.messages.scrollHeight;}
  }
  function applyFontTheme(theme){const selected=FONT_THEMES[theme]?theme:'sans';document.documentElement.style.setProperty('--chat-font',FONT_THEMES[selected]);if(els.fontTheme)els.fontTheme.value=selected;localStorage.setItem(FONT_KEY,selected);}
  function showToast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.remove('show'),2400);}
  function enterApp(){els.welcome.hidden=true;els.app.hidden=false;const saved=conversations.find(chat=>chat.id===activeId&&chat.messages.length);if(saved)showChat();else{activeId='';showDashboard()}renderTopics();renderHistory();}
  function goHome(){els.app.hidden=true;els.welcome.hidden=false;closeSidebar();window.scrollTo({top:0,behavior:'smooth'});}
  function openSidebar(){els.sidebar.classList.add('open');els.scrim.classList.add('visible');}
  function closeSidebar(){els.sidebar.classList.remove('open');els.scrim.classList.remove('visible');}
  function autoResize(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,180)}px`;}

  $('#startLearning').addEventListener('click',enterApp);$('#enterFromNav').addEventListener('click',enterApp);$('#parallaxStart').addEventListener('click',enterApp);$('#homeButton').addEventListener('click',goHome);els.newChat.addEventListener('click',newConversation);$('#openSidebar').addEventListener('click',openSidebar);$('#closeSidebar').addEventListener('click',closeSidebar);els.scrim.addEventListener('click',closeSidebar);
  $('#clearHistory').addEventListener('click',()=>{if(conversations.length&&confirm('Delete all saved conversations from this browser?')){conversations=[];activeId='';persist();showDashboard();showToast('Conversation history cleared.')}});
  $('#addTopic').addEventListener('click',()=>{const name=prompt('New notebook name');if(name?.trim())addNotebook(name)});
  els.historySearch.addEventListener('input',renderHistory);
  document.querySelectorAll('[data-topic]').forEach(card=>card.addEventListener('click',()=>{const topic=card.dataset.topic;if(!topics.includes(topic))addNotebook(topic);els.dashboardTopic.value=topic;els.dashboardInput.value=card.dataset.prompt;els.dashboardInput.focus()}));
  els.dashboardForm.addEventListener('submit',event=>{event.preventDefault();const text=els.dashboardInput.value.trim();if(!text)return;const topic=els.dashboardTopic.value;activeId='';enterApp();els.dashboardInput.value='';autoResize(els.dashboardInput);sendMessage(text,topic)});
  els.chatForm.addEventListener('submit',event=>{event.preventDefault();const text=els.chatInput.value.trim();if(!text)return;els.chatInput.value='';autoResize(els.chatInput);sendMessage(text)});
  for(const input of [els.dashboardInput,els.chatInput]){input.addEventListener('input',()=>autoResize(input));input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();input.form.requestSubmit()}})}
  els.chatTopic.addEventListener('change',()=>{const chat=currentChat();if(chat){chat.topic=els.chatTopic.value;chat.updatedAt=Date.now();persist()}});
  els.fontTheme?.addEventListener('change',()=>applyFontTheme(els.fontTheme.value));
  const savedTheme=localStorage.getItem(FONT_KEY)||'rounded';applyFontTheme(savedTheme);
  syncNotebookSelects();renderTopics();renderHistory();
})();
