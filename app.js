// EduCator browser app: conversation history is intentionally stored in localStorage on this device.
(() => {
  'use strict';
  const API_URL = window.EDUCATOR_API_URL || '/api/solve';
  const STORAGE_KEY = 'educator.conversations.v1';
  const ACTIVE_KEY = 'educator.activeConversation.v1';
  const MAX_HISTORY = 60;
  const $ = (selector) => document.querySelector(selector);
  const els = {
    welcome: $('#welcome'), app: $('#app'), dashboard: $('#dashboard'), chatView: $('#chatView'),
    messages: $('#messages'), history: $('#historyList'), emptyHistory: $('#emptyHistory'),
    historySearch: $('#historySearch'), dashboardForm: $('#dashboardForm'), dashboardInput: $('#dashboardInput'),
    chatForm: $('#chatForm'), chatInput: $('#chatInput'), newChat: $('#newChat'),
    title: $('#topbarTitle'), toast: $('#toast'), sidebar: $('#sidebar'), scrim: $('#sidebarScrim')
  };
  let conversations = loadConversations();
  let activeId = localStorage.getItem(ACTIVE_KEY) || '';
  let busy = false;
  let toastTimer;

  function loadConversations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages)).slice(0, MAX_HISTORY) : [];
    } catch { return []; }
  }
  function persist() {
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    conversations = conversations.slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); else localStorage.removeItem(ACTIVE_KEY);
    } catch { showToast('Browser storage is full. Remove older chats to save this one.'); }
    renderHistory();
  }
  function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
  function currentChat() { return conversations.find((chat) => chat.id === activeId); }
  function newConversation() {
    activeId = '';
    persist();
    showDashboard();
    closeSidebar();
    els.dashboardInput.focus({ preventScroll: true });
  }
  function startConversation(text) {
    const chat = { id: makeId(), title: titleFrom(text), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    conversations.unshift(chat);
    activeId = chat.id;
    persist();
    renderChat();
    closeSidebar();
    return chat;
  }
  function titleFrom(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > 42 ? `${cleaned.slice(0, 40).trimEnd()}…` : (cleaned || 'New conversation');
  }
  function showDashboard() {
    els.dashboard.hidden = false;
    els.chatView.hidden = true;
    els.title.textContent = 'Your learning space';
    renderHistory();
  }
  function showChat() {
    els.dashboard.hidden = true;
    els.chatView.hidden = false;
    renderChat();
  }
  function selectConversation(id) {
    if (!conversations.some((chat) => chat.id === id)) return;
    activeId = id;
    persist();
    showChat();
    closeSidebar();
  }
  function iconButton(name, path) {
    const button = document.createElement('button');
    button.className = `history-action history-action-${name}`;
    button.type = 'button';
    button.title = name === 'rename' ? 'Rename conversation' : 'Delete conversation';
    button.setAttribute('aria-label', `${name === 'rename' ? 'Rename' : 'Delete'} conversation`);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
    return button;
  }
  function renderHistory() {
    const query = els.historySearch.value.trim().toLowerCase();
    const items = conversations.filter((chat) => chat.title.toLowerCase().includes(query));
    els.history.replaceChildren();
    for (const chat of items) {
      const row = document.createElement('div');
      row.className = `history-item${chat.id === activeId && !els.chatView.hidden ? ' active' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open conversation: ${chat.title}`);
      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = chat.title;
      const actions = document.createElement('span');
      actions.className = 'history-item-actions';
      const rename = iconButton('rename', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>');
      const remove = iconButton('delete', '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>');
      rename.addEventListener('click', (event) => { event.stopPropagation(); openRenameDialog(chat); });
      remove.addEventListener('click', (event) => { event.stopPropagation(); confirmDelete(chat); });
      actions.append(rename, remove);
      row.append(title, actions);
      row.addEventListener('click', () => selectConversation(chat.id));
      row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectConversation(chat.id); }
      });
      els.history.append(row);
    }
    els.emptyHistory.hidden = items.length > 0;
    els.emptyHistory.textContent = query ? 'No conversations match that search.' : 'Your conversations will show up here.';
  }
  function confirmDelete(chat) {
    if (!window.confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
    conversations = conversations.filter((item) => item.id !== chat.id);
    if (activeId === chat.id) { activeId = ''; showDashboard(); }
    persist();
    showToast('Conversation deleted.');
  }
  function openRenameDialog(chat) {
    let dialog = $('#renameDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'renameDialog';
      dialog.className = 'rename-dialog';
      dialog.innerHTML = '<form method="dialog" id="renameForm"><label for="renameInput">Conversation name</label><input id="renameInput" maxlength="70" required><div class="rename-actions"><button class="rename-cancel" value="cancel">Cancel</button><button class="rename-save" id="renameSave" value="save">Save name</button></div></form>';
      document.body.append(dialog);
      dialog.querySelector('form').addEventListener('submit', (event) => {
        if (event.submitter?.value !== 'save') return;
        event.preventDefault();
        const name = dialog.querySelector('#renameInput').value.trim();
        if (!name || !dialog._conversation) return;
        dialog._conversation.title = name;
        dialog._conversation.updatedAt = Date.now();
        persist();
        dialog.close();
        showToast('Conversation renamed.');
      });
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    dialog._conversation = chat;
    dialog.querySelector('#renameInput').value = chat.title;
    dialog.showModal();
    dialog.querySelector('#renameInput').focus();
    dialog.querySelector('#renameInput').select();
  }
  function clearHistory() {
    if (!conversations.length) return showToast('There are no saved conversations yet.');
    if (!window.confirm('Delete all saved conversations from this browser? This cannot be undone.')) return;
    conversations = [];
    activeId = '';
    persist();
    showDashboard();
    showToast('Your saved conversations were cleared.');
  }
  function renderChat() {
    const chat = currentChat();
    if (!chat) return showDashboard();
    els.title.textContent = chat.title;
    els.messages.replaceChildren();
    for (const message of chat.messages) appendMessage(message.role, message.text, false);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  // Render a small safe Markdown subset; all model-provided text is escaped before formatting.
  function formatText(text) {
    const blocks = [];
    let safe = escapeHtml(String(text)).replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const token = `@@CODE${blocks.length}@@`;
      blocks.push(`<pre><code>${code.trim().replace(/\n$/, '')}</code></pre>`);
      return token;
    });
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<em>$2</em>')
      .replace(/(^|\s)\* (.+?)(?=\n|$)/g, '$1• $2')
      .split(/\n{2,}/).map((part) => part.startsWith('@@CODE') ? part : `<p>${part.replace(/\n/g, '<br>')}</p>`).join('');
    return safe.replace(/@@CODE(\d+)@@/g, (_m, index) => blocks[Number(index)] || '');
  }
  function appendMessage(role, text, withActions = true) {
    const row = document.createElement('article');
    row.className = `message-row ${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar'; avatar.textContent = role === 'assistant' ? 'E' : 'Y';
    avatar.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div'); content.className = 'message-content';
    const author = document.createElement('div'); author.className = 'message-author'; author.textContent = role === 'assistant' ? 'EduCator' : 'You';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.innerHTML = formatText(text);
    content.append(author, bubble);
    if (role === 'assistant' && withActions) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); showToast('Answer copied.'); } catch { showToast('Could not access the clipboard.'); } });
      actions.append(copy); content.append(actions);
    }
    row.append(avatar, content); els.messages.append(row);
    return row;
  }
  function showTyping() {
    const row = appendMessage('assistant', '', false);
    row.classList.add('typing-row');
    row.querySelector('.message-bubble').innerHTML = '<span class="typing-indicator" aria-label="EduCator is thinking"><i></i><i></i><i></i></span>';
    els.messages.scrollTop = els.messages.scrollHeight;
    return row;
  }
  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || busy) return;
    let chat = currentChat();
    if (!chat) chat = startConversation(text);
    if (!chat.messages.length) chat.title = titleFrom(text);
    chat.messages.push({ role: 'user', text });
    chat.updatedAt = Date.now();
    appendMessage('user', text, false);
    persist();
    els.title.textContent = chat.title;
    busy = true;
    const submit = els.chatForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    const typing = showTyping();
    try {
      const history = chat.messages.slice(-30).map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', text: message.text }));
      const response = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `The service returned an error (${response.status}).`);
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('No answer came back. Please try again.');
      typing.remove();
      const answer = data.answer.trim();
      chat.messages.push({ role: 'assistant', text: answer });
      chat.updatedAt = Date.now();
      appendMessage('assistant', answer);
      persist();
    } catch (error) {
      typing.remove();
      const errorText = error instanceof TypeError ? 'Could not reach the learning service. Check the connection and try again.' : error.message;
      const retry = document.createElement('div'); retry.className = 'message-row assistant';
      retry.innerHTML = `<div class="message-avatar" aria-hidden="true">E</div><div class="message-content"><div class="message-author">EduCator</div><div class="message-bubble"><p>${escapeHtml(errorText)}</p></div><div class="message-actions"><button type="button">Try again</button></div></div>`;
      retry.querySelector('button').addEventListener('click', () => { retry.remove(); sendMessage(text); });
      els.messages.append(retry);
    } finally {
      busy = false; submit.disabled = false; els.messages.scrollTop = els.messages.scrollHeight;
    }
  }
  function autoResize(textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`; }
  function showToast(message) {
    els.toast.textContent = message; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
  }
  function buildLandingParallax() {
    const welcome = els.welcome;
    if (!welcome || welcome.querySelector('.parallax-panel')) return;
    const first = document.createElement('section');
    first.className = 'parallax-panel parallax-study';
    first.innerHTML = '<div class="parallax-caption"><span class="tiny-label">FOLLOW YOUR CURIOSITY</span><h2>Every subject has a story.</h2><p>Take a closer look, ask one more question, and let understanding build at your own pace.</p></div>';
    const second = document.createElement('section');
    second.className = 'parallax-panel parallax-ideas';
    second.innerHTML = '<div class="parallax-caption"><span class="tiny-label">SMALL STEPS. BIG “AHA!” MOMENTS.</span><h2>Learn something new today.</h2><p>Bring the question. We’ll work through the ideas together.</p><button class="button button-dark parallax-cta" type="button">Open my study space <span aria-hidden="true">→</span></button></div>';
    const features = welcome.querySelector('.welcome-bottom');
    const footer = welcome.querySelector('.welcome-footer');
    welcome.insertBefore(first, features);
    welcome.insertBefore(second, footer);
    second.querySelector('button').addEventListener('click', enterApp);
    const styles = document.createElement('link');
    styles.rel = 'stylesheet'; styles.href = 'enhancements.css';
    document.head.append(styles);
  }
  function enterApp() {
    els.welcome.hidden = true; els.app.hidden = false;
    const saved = conversations.find((chat) => chat.id === activeId);
    if (saved && saved.messages.length) showChat(); else { activeId = ''; showDashboard(); }
    renderHistory();
  }
  function goHome() { els.app.hidden = true; els.welcome.hidden = false; closeSidebar(); window.scrollTo(0, 0); }
  function openSidebar() { els.sidebar.classList.add('open'); els.scrim.classList.add('visible'); }
  function closeSidebar() { els.sidebar.classList.remove('open'); els.scrim.classList.remove('visible'); }

  buildLandingParallax();
  $('#startLearning').addEventListener('click', enterApp);
  $('#enterFromNav').addEventListener('click', enterApp);
  $('#homeButton').addEventListener('click', goHome);
  els.newChat.addEventListener('click', newConversation);
  $('#clearHistory').addEventListener('click', clearHistory);
  $('#openSidebar').addEventListener('click', openSidebar);
  $('#closeSidebar').addEventListener('click', closeSidebar);
  els.scrim.addEventListener('click', closeSidebar);
  els.historySearch.addEventListener('input', renderHistory);
  els.dashboardForm.addEventListener('submit', (event) => {
    event.preventDefault(); const text = els.dashboardInput.value.trim(); if (!text) return;
    activeId = ''; enterApp(); els.dashboardInput.value = ''; autoResize(els.dashboardInput); sendMessage(text);
  });
  els.chatForm.addEventListener('submit', (event) => { event.preventDefault(); const text = els.chatInput.value.trim(); if (!text) return; els.chatInput.value = ''; autoResize(els.chatInput); sendMessage(text); });
  for (const input of [els.dashboardInput, els.chatInput]) {
    input.addEventListener('input', () => autoResize(input));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); input.form.requestSubmit(); } });
  }
  document.addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-prompt]');
    if (!suggestion) return;
    const text = suggestion.dataset.prompt;
    if (suggestion.closest('#dashboard')) { els.dashboardInput.value = text; autoResize(els.dashboardInput); els.dashboardInput.focus(); }
    else { enterApp(); sendMessage(text); }
  });
  renderHistory();
})();
