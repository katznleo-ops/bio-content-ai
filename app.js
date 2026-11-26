// EduCator browser app (served at /educator/app/).
// Everything is stored in this browser's localStorage. Routes live in the URL hash so a refresh
// keeps the learner exactly where they were:
//   #/                      home (general chat composer + notebooks)
//   #/chat/:id              general chat
//   #/notebooks/new         create a notebook
//   #/nb/:id                notebook overview
//   #/nb/:id/plan           learning plan
//   #/nb/:id/quizzes        quizzes
//   #/nb/:id/sessions       notebook chat sessions
//   #/nb/:id/settings       edit / delete notebook
//   #/nb/:id/chat/:chatId   notebook chat session (private to the notebook)
//   #/nb/:id/quiz/:quizId   take / review a quiz
(() => {
  'use strict';

  // ---------- Config ----------
  const API_URL = window.EDUCATOR_API_URL || 'https://bio-content-ai-revised.vercel.app/api/solve';
  const KEYS = { chats: 'educator.chats.v3', notebooks: 'educator.notebooks.v3', font: 'educator.fontTheme.v1' };
  const LEGACY = { chats: 'educator.conversations.v2', topics: 'educator.topics.v2' };
  const FONTS = { sans: "'DM Sans',system-ui,sans-serif", rounded: "'Nunito',system-ui,sans-serif", serif: "'Lora',Georgia,serif", readable: "'Atkinson Hyperlegible',Arial,sans-serif" };
  const MAX_FILES = 4, MAX_FILE_SIZE = 1024 * 1024, MAX_TOTAL_SIZE = 2 * 1024 * 1024;
  const MAX_GENERAL_CHATS = 60, MAX_NOTEBOOK_CHATS = 60;
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv']);
  const COLORS = [
    { id: 'violet', hex: '#6a5ae0' }, { id: 'green', hex: '#2c9a6a' }, { id: 'coral', hex: '#e0683a' },
    { id: 'blue', hex: '#3576dd' }, { id: 'pink', hex: '#d2467f' }, { id: 'teal', hex: '#17929f' }
  ];
  const ICONS = ['📐', '🧪', '🧬', '📚', '🌍', '🏛️', '💻', '🎨', '🎵', '🗣️', '🧠', '📈'];
  const GRADES = { elementary: 'Elementary (K–5)', middle: 'Middle school (6–8)', high: 'High school (9–12)', college: 'College / university', adult: 'Adult / self-study' };
  const LEVELS = { new: 'Just starting out', basics: 'Know the basics', intermediate: 'Intermediate', advanced: 'Advanced' };
  const PACES = { light: '15–20 min, a few times a week', steady: 'About 30 min most days', intensive: 'An hour or more a day' };
  const DIFFICULTIES = { easier: 'Easier', matched: 'Just right', challenge: 'Challenge me' };
  // The original pastel subject cards; each opens a pre-filled notebook form.
  // The pastel subject cards. They only pick a subject area: the learner fills in the rest.
  const TEMPLATES = {
    math: { tint: 'math', glyph: '∑', title: 'Math & numbers', caption: 'Make tricky ideas click', icon: '📐', color: 'violet', placeholder: 'e.g. Algebra 1, Geometry, Calculus' },
    science: { tint: 'science', glyph: '✳', title: 'Science & nature', caption: 'Find out how it works', icon: '🧪', color: 'green', placeholder: 'e.g. Biology, Chemistry, Physics' },
    writing: { tint: 'writing', glyph: 'Aa', title: 'Writing & language', caption: 'Find the right words', icon: '📚', color: 'coral', placeholder: 'e.g. Essay writing, English, Spanish' },
    history: { tint: 'history', glyph: '◷', title: 'History & society', caption: 'Connect past and present', icon: '🏛️', color: 'blue', placeholder: 'e.g. World history, US government' }
  };

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (text) => (typeof window.renderMarkdown === 'function' ? window.renderMarkdown(text) : `<p>${esc(text).replace(/\n/g, '<br>')}</p>`);
  const mdInline = (text) => md(text).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
  const titleFrom = (text) => { const clean = String(text || '').replace(/\s+/g, ' ').trim(); return clean.length > 48 ? `${clean.slice(0, 46).trimEnd()}…` : clean || 'New conversation'; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const colorHex = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
  function timeAgo(ts) {
    if (!ts) return 'Not yet';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return plural(Math.floor(s / 3600), 'hour') + ' ago';
    if (s < 86400 * 2) return 'Yesterday';
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
    return new Date(ts).toLocaleDateString();
  }
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };

  // ---------- State ----------
  let chats = load(KEYS.chats, null);
  let notebooks = load(KEYS.notebooks, null);
  let route = { view: 'home' }, lastKey = null;
  let pendingFiles = [], busy = false, streaming = null, frame = 0, chatQuery = '', draftTemplate = null;
  const jobs = {};      // in-flight generations, e.g. jobs['plan:<nbId>'] = true
  const jobErrors = {}; // last error message per job key

  function newNotebook(fields) {
    return {
      id: uid(), name: fields.name || 'Notebook', icon: fields.icon || ICONS[0], color: fields.color || COLORS[0].id,
      goal: fields.goal || '', grade: fields.grade || '', struggles: fields.struggles || '', level: fields.level || 'new', pace: fields.pace || 'steady', deadline: fields.deadline || '',
      createdAt: Date.now(), updatedAt: Date.now(), lastStudiedAt: 0, plan: null, quizzes: []
    };
  }

  // One-time migration from the earlier "topics" storage format.
  function migrate() {
    if (Array.isArray(chats) && Array.isArray(notebooks)) return;
    const oldChats = load(LEGACY.chats, []), oldTopics = load(LEGACY.topics, []);
    const idByName = {};
    notebooks = (Array.isArray(oldTopics) ? oldTopics : []).filter((n) => typeof n === 'string' && n.trim()).map((name, i) => {
      const nb = newNotebook({ name, color: COLORS[i % COLORS.length].id, icon: ICONS[i % ICONS.length] });
      idByName[name] = nb.id; return nb;
    });
    chats = (Array.isArray(oldChats) ? oldChats : []).filter((c) => c && Array.isArray(c.messages)).map((c) => ({
      id: c.id || uid(), notebookId: idByName[c.topic] || '', title: c.title || 'Conversation',
      createdAt: c.createdAt || Date.now(), updatedAt: c.updatedAt || Date.now(), messages: c.messages
    }));
    save();
  }

  function save() {
    chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const counts = {};
    chats = chats.filter((c) => { const k = c.notebookId || ''; counts[k] = (counts[k] || 0) + 1; return counts[k] <= (k ? MAX_NOTEBOOK_CHATS : MAX_GENERAL_CHATS); });
    try {
      localStorage.setItem(KEYS.chats, JSON.stringify(chats));
      localStorage.setItem(KEYS.notebooks, JSON.stringify(notebooks));
    } catch { toast('Browser storage is full. Delete older chats or attachments to free up space.'); }
  }

  const findNb = (id) => notebooks.find((n) => n.id === id);
  const gradeLabel = (nb) => GRADES[nb.grade] || (nb.level ? LEVELS[nb.level] : '') || '';
  const diagnosticOf = (nb) => nb.quizzes.find((q) => q.kind === 'diagnostic');
  function diagnosticSummary(nb) {
    const q = diagnosticOf(nb); const a = q?.attempts[q.attempts.length - 1];
    return a ? { quiz: q, attempt: a, missed: q.questions.filter((x, i) => a.answers[i] !== x.answer), assessment: a.assessment || null } : null;
  }
  const nbChats = (nb) => chats.filter((c) => c.notebookId === nb.id);
  const generalChats = () => chats.filter((c) => !c.notebookId);
  function nbProgress(nb) {
    const lessons = nb.plan?.lessons || [];
    const done = lessons.filter((l) => l.done).length;
    return { done, total: lessons.length, pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0 };
  }
  function quizStats(nb) {
    const attempts = nb.quizzes.flatMap((q) => q.attempts.map((a) => ({ ...a, quiz: q })));
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score / a.total, 0) / attempts.length * 100) : null;
    return { attempts: attempts.sort((a, b) => b.at - a.at), avg };
  }

  // ---------- DOM roots ----------
  const el = {
    sidebar: $('#sidebar'), sidebarBody: $('#sidebarBody'), scrim: $('#sidebarScrim'), view: $('#view'), crumbs: $('#crumbs'),
    font: $('#fontTheme'), toast: $('#toast'), fileInput: $('#fileInput'),
    dialog: $('#siteDialog'), dialogTitle: $('#dialogTitle'), dialogLabel: $('#dialogLabel'), dialogInput: $('#dialogInput'), dialogSave: $('#dialogSave'), dialogCancel: $('#dialogCancel')
  };

  let toastTimer;
  function toast(message) { el.toast.textContent = message; el.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200); }

  let dialogCallback = null;
  function showDialog({ title, label, value = '', saveText = 'Save', danger = false, confirm = false, onSave }) {
    el.dialogTitle.textContent = title; el.dialogLabel.textContent = label; el.dialogInput.value = value;
    el.dialogInput.hidden = confirm; el.dialogSave.textContent = saveText; el.dialogSave.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    dialogCallback = onSave; el.dialog.showModal();
    if (confirm) el.dialogSave.focus(); else setTimeout(() => { el.dialogInput.focus(); el.dialogInput.select(); }, 30);
  }
  el.dialogSave.addEventListener('click', () => {
    const value = el.dialogInput.value.trim();
    if (!el.dialogInput.hidden && !value) { el.dialogInput.focus(); return; }
    const cb = dialogCallback; dialogCallback = null; el.dialog.close(); cb?.(value);
  });
  el.dialogCancel.addEventListener('click', () => { dialogCallback = null; el.dialog.close(); });
  el.dialogInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.dialogSave.click(); } });

  // ---------- Routing ----------
  function parseRoute() {
    const [path] = location.hash.replace(/^#\/?/, '').split('?');
    const p = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (!p.length) return { view: 'home' };
    if (p[0] === 'chat' && p[1]) return { view: 'chat', chatId: p[1] };
    if (p[0] === 'notebooks' && p[1] === 'new') return { view: 'new-notebook' };
    if (p[0] === 'nb' && p[1]) {
      const base = { nbId: p[1] };
      if (p[2] === 'chat' && p[3]) return { ...base, view: 'chat', chatId: p[3] };
      if (p[2] === 'quiz' && p[3]) return { ...base, view: 'quiz', quizId: p[3] };
      if (['plan', 'quizzes', 'sessions', 'settings'].includes(p[2])) return { ...base, view: `nb-${p[2]}` };
      return { ...base, view: 'nb-overview' };
    }
    return { view: 'home' };
  }
  function go(hash, { replace = false } = {}) {
    if (location.hash !== hash) (replace ? history.replaceState(null, '', hash) : history.pushState(null, '', hash));
    render(true);
  }
  window.addEventListener('hashchange', () => render());
  window.addEventListener('popstate', () => render());

  function render(force = false) {
    const key = location.hash || '#/';
    if (!force && key === lastKey) return;
    lastKey = key;
    route = parseRoute();
    pendingFiles = [];
    const nb = route.nbId ? findNb(route.nbId) : null;
    if (route.nbId && !nb) return go('#/', { replace: true });
    let chat = null, quiz = null;
    if (route.view === 'chat') {
      chat = chats.find((c) => c.id === route.chatId);
      if (!chat || (chat.notebookId || '') !== (route.nbId || '')) return go(nb ? `#/nb/${nb.id}/sessions` : '#/', { replace: true });
    }
    if (route.view === 'quiz') {
      quiz = nb.quizzes.find((q) => q.id === route.quizId);
      if (!quiz) return go(`#/nb/${nb.id}/quizzes`, { replace: true });
    }
    document.body.dataset.mode = nb ? 'notebook' : 'general';
    document.body.style.setProperty('--accent', nb ? colorHex(nb.color) : COLORS[0].hex);
    renderSidebar(nb, chat);
    const views = {
      home: viewHome, 'new-notebook': () => viewNotebookForm(null), chat: () => viewChat(chat, nb),
      'nb-overview': () => viewOverview(nb), 'nb-plan': () => viewPlan(nb), 'nb-quizzes': () => viewQuizzes(nb),
      'nb-sessions': () => viewSessions(nb), 'nb-settings': () => viewNotebookForm(nb), quiz: () => viewQuiz(nb, quiz)
    };
    (views[route.view] || viewHome)();
    renderCrumbs(nb, chat, quiz);
    document.title = `${nb ? nb.name : chat ? chat.title : 'Study space'} · EduCator`;
    if (route.view !== 'chat') el.view.scrollTop = 0;
    closeSidebar();
  }
  // Re-render the current route if it belongs to the given notebook (used after background jobs finish).
  function refreshIf(nbId) { if ((route.nbId || '') === (nbId || '') && route.view !== 'chat') render(true); else renderSidebar(route.nbId ? findNb(route.nbId) : null, route.view === 'chat' ? chats.find((c) => c.id === route.chatId) : null); }

  function renderCrumbs(nb, chat, quiz) {
    const parts = [`<a href="#/">EduCator</a>`];
    if (nb) {
      parts.push(`<a href="#/nb/${nb.id}">${esc(nb.icon)} ${esc(nb.name)}</a>`);
      const labels = { 'nb-plan': 'Learning plan', 'nb-quizzes': 'Quizzes', 'nb-sessions': 'Sessions', 'nb-settings': 'Settings' };
      if (labels[route.view]) parts.push(`<span>${labels[route.view]}</span>`);
      if (chat) parts.push(`<span>${esc(chat.title)}</span>`);
      if (quiz) parts.push(`<a href="#/nb/${nb.id}/quizzes">Quizzes</a>`, `<span>${esc(quiz.title)}</span>`);
    } else if (chat) parts.push(`<span>${esc(chat.title)}</span>`);
    else if (route.view === 'new-notebook') parts.push('<span>New notebook</span>');
    else parts.push('<span>Home</span>');
    el.crumbs.innerHTML = parts.join('<i>/</i>');
  }

  // ---------- Sidebar ----------
  function chatRow(chat, href, active) {
    return `<div class="sb-chat${active ? ' active' : ''}"><a href="${href}" title="${esc(chat.title)}">${chat.lessonId ? '<span class="sb-chat-tag">Lesson</span>' : ''}${esc(chat.title)}</a>
      <button type="button" class="sb-icon" data-action="rename-chat" data-id="${chat.id}" aria-label="Rename conversation" title="Rename">✎</button>
      <button type="button" class="sb-icon danger" data-action="delete-chat" data-id="${chat.id}" aria-label="Delete conversation" title="Delete">×</button></div>`;
  }
  function renderChatList() {
    const list = $('#sbChatList'); if (!list) return;
    const q = chatQuery.toLowerCase();
    const items = generalChats().filter((c) => c.title.toLowerCase().includes(q));
    list.innerHTML = items.map((c) => chatRow(c, `#/chat/${c.id}`, route.view === 'chat' && route.chatId === c.id)).join('')
      || `<p class="sb-empty">${q ? 'No matching chats.' : 'Your chats will appear here.'}</p>`;
  }
  function renderSidebar(nb, chat) {
    if (!nb) {
      el.sidebarBody.innerHTML = `
        <a class="sb-new" href="#/"><span class="plus-icon">＋</span> New conversation</a>
        <div class="sb-heading"><span>Notebooks</span><a class="sb-link" href="#/notebooks/new">＋ New</a></div>
        <nav class="sb-notebooks">${notebooks.map((n) => { const p = nbProgress(n); return `
          <a class="sb-notebook" href="#/nb/${n.id}" style="--nb:${colorHex(n.color)}"><span class="nb-icon">${esc(n.icon)}</span><span class="sb-nb-name">${esc(n.name)}</span>${p.total ? `<span class="sb-nb-pct">${p.pct}%</span>` : ''}</a>`; }).join('')
          || '<p class="sb-empty">Notebooks are private study spaces with a learning plan, lessons, and quizzes.</p>'}</nav>
        <div class="sb-heading"><span>Recent chats</span><button type="button" class="sb-link" data-action="clear-chats">Clear</button></div>
        <label class="sb-search"><span aria-hidden="true">⌕</span><input id="sbSearch" type="search" placeholder="Search chats" autocomplete="off" value="${esc(chatQuery)}"></label>
        <div id="sbChatList" class="sb-chats"></div>`;
      renderChatList();
      $('#sbSearch').addEventListener('input', (e) => { chatQuery = e.target.value; renderChatList(); });
      return;
    }
    const p = nbProgress(nb);
    const tab = (view, href, icon, label) => `<a class="sb-tab${route.view === view ? ' active' : ''}" href="${href}"><span>${icon}</span>${label}</a>`;
    const sessions = nbChats(nb);
    el.sidebarBody.innerHTML = `
      <a class="sb-back" href="#/">← All of EduCator</a>
      <div class="sb-nb-card">
        <span class="nb-icon lg">${esc(nb.icon)}</span>
        <div class="sb-nb-meta"><strong>${esc(nb.name)}</strong><small>${p.total ? `${p.done} of ${plural(p.total, 'lesson')} done` : 'No plan yet'}</small></div>
        <div class="progress"><i style="width:${p.pct}%"></i></div>
      </div>
      <nav class="sb-tabs">
        ${tab('nb-overview', `#/nb/${nb.id}`, '◎', 'Overview')}
        ${tab('nb-plan', `#/nb/${nb.id}/plan`, '↗', 'Learning plan')}
        ${tab('nb-quizzes', `#/nb/${nb.id}/quizzes`, '✦', 'Quizzes')}
        ${tab('nb-sessions', `#/nb/${nb.id}/sessions`, '✎', 'Sessions')}
      </nav>
      <a class="sb-new" href="#/nb/${nb.id}/sessions"><span class="plus-icon">＋</span> New session</a>
      <div class="sb-heading"><span>Sessions in this notebook</span></div>
      <div class="sb-chats">${sessions.map((c) => chatRow(c, `#/nb/${nb.id}/chat/${c.id}`, chat?.id === c.id)).join('') || '<p class="sb-empty">Sessions you start here stay inside this notebook.</p>'}</div>
      <a class="sb-settings${route.view === 'nb-settings' ? ' active' : ''}" href="#/nb/${nb.id}/settings">⚙ Notebook settings</a>`;
  }
  function openSidebar() { el.sidebar.classList.add('open'); el.scrim.classList.add('visible'); }
  function closeSidebar() { el.sidebar.classList.remove('open'); el.scrim.classList.remove('visible'); }

  // ---------- Composer ----------
  function composer(kind, placeholder, { big = false, value = '' } = {}) {
    return `<form class="composer${big ? ' composer-big' : ''}" data-composer="${kind}">
      <label class="sr-only" for="composer-${kind}">${esc(placeholder)}</label>
      <textarea id="composer-${kind}" rows="1" maxlength="8000" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
      <div class="attachment-list"></div>
      <div class="composer-tools">
        <button type="button" class="composer-attach" data-action="attach" title="Attach a photo, PDF, or text file"><span aria-hidden="true">＋</span> Attach</button>
        <span class="composer-hint">Enter to send · Shift + Enter for a new line</span>
        <button class="send-button" type="submit" aria-label="Send" title="Send"${busy ? ' disabled' : ''}>↑</button>
      </div></form>`;
  }
  function autoResize(t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 220)}px`; }
  function renderAttachments() {
    const list = $('.composer .attachment-list', el.view); if (!list) return;
    list.innerHTML = pendingFiles.map((f, i) => `<div class="attachment-chip">${f.type.startsWith('image/') ? `<img src="${f.data}" alt="">` : '<span class="attachment-file-icon">▧</span>'}<span title="${esc(f.name)}">${esc(f.name)}</span><button type="button" data-action="remove-file" data-index="${i}" aria-label="Remove ${esc(f.name)}">×</button></div>`).join('');
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!ALLOWED_TYPES.has(file.type)) return reject(new Error(`${file.name}: unsupported file type.`));
      if (file.size > MAX_FILE_SIZE) return reject(new Error(`${file.name} is larger than 1 MB.`));
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: reader.result });
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }
  async function addFiles(fileList) {
    for (const file of [...fileList]) {
      if (pendingFiles.length >= MAX_FILES) { toast(`Attach up to ${MAX_FILES} files per message.`); break; }
      try {
        if (pendingFiles.reduce((s, f) => s + f.size, 0) + file.size > MAX_TOTAL_SIZE) throw new Error('Attachments are limited to 2 MB total.');
        pendingFiles.push(await readFile(file));
      } catch (e) { toast(e.message); }
    }
    renderAttachments();
  }
  el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });

  function createChat({ notebookId = '', title = 'New conversation', lessonId = '' } = {}) {
    const chat = { id: uid(), notebookId, title, lessonId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    chats.unshift(chat); save(); return chat;
  }

  // ---------- Chat ----------
  function messageHtml(m) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const files = (m.attachments || []).map((f) => `<div class="message-attachment">${f.type?.startsWith('image/') && f.data ? `<img src="${f.data}" alt="${esc(f.name)}">` : `<span class="file-icon">▧</span><span>${esc(f.name)}</span>`}</div>`).join('');
    const body = m.text ? md(m.text) : '';
    return `<article class="message-row ${role}"><div class="message-avatar" aria-hidden="true">${role === 'assistant' ? 'E' : 'You'}</div>
      <div class="message-content"><div class="message-author">${role === 'assistant' ? 'EduCator' : 'You'}</div><div class="message-bubble">${body}${files}</div>
      ${role === 'assistant' && !m.error ? '<div class="message-actions"><button type="button" data-action="copy-answer">Copy answer</button></div>' : ''}</div></article>`;
  }
  function appendMessage(m) {
    const box = $('#messages'); if (!box) return;
    box.insertAdjacentHTML('beforeend', messageHtml(m));
    const row = box.lastElementChild;
    const copy = row.querySelector('[data-action="copy-answer"]');
    if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(m.text || ''); toast('Answer copied.'); } catch { toast('Could not access the clipboard.'); } });
  }
  function lessonOf(nb, chat) {
    if (!nb || !chat?.lessonId || !nb.plan) return null;
    const i = nb.plan.lessons.findIndex((l) => l.id === chat.lessonId);
    return i < 0 ? null : { lesson: nb.plan.lessons[i], index: i };
  }
  function viewChat(chat, nb) {
    const lesson = lessonOf(nb, chat);
    const banner = lesson ? `<div class="lesson-banner"><div><span class="eyebrow">Lesson ${lesson.index + 1} of ${nb.plan.lessons.length}</span><strong>${esc(lesson.lesson.title)}</strong></div>
      <div class="lesson-banner-actions"><button type="button" class="btn ${lesson.lesson.done ? 'btn-soft' : 'btn-primary'}" data-action="toggle-lesson" data-id="${lesson.lesson.id}">${lesson.lesson.done ? '✓ Completed' : 'Mark lesson complete'}</button>
      <button type="button" class="btn btn-ghost" data-action="lesson-quiz" data-id="${lesson.lesson.id}">Quiz me on this</button></div></div>` : '';
    const empty = !chat.messages.length && !(streaming && streaming.chatId === chat.id);
    el.view.innerHTML = `<div class="chat-view">${banner}
      <div id="messages" class="messages" role="log" aria-live="polite">${empty ? `<div class="chat-empty"><h2>${nb ? `${esc(nb.icon)} New ${esc(nb.name)} session` : 'New chat'}</h2><p>Ask anything to get started.</p></div>` : ''}</div>
      <div class="chat-compose-area">${composer('chat', nb ? `Ask your ${nb.name} tutor…` : 'Ask a follow-up…')}</div></div>`;
    chat.messages.forEach(appendMessage);
    const box = $('#messages'); box.scrollTop = box.scrollHeight;
    if (streaming && streaming.chatId === chat.id) { paintLive(); pinQuestion(); }
    $('#composer-chat').focus({ preventScroll: true });
  }
  // When a question is sent, scroll it to the top of the chat so the answer starts right below it.
  // A spacer at the end of the list makes room to scroll that far even while the answer is short.
  function updateSpacer() {
    const box = $('#messages'); if (!box?.dataset.pin) return;
    const questions = box.querySelectorAll('.message-row.user'); const q = questions[questions.length - 1]; if (!q) return;
    let spacer = box.querySelector('.scroll-spacer');
    if (!spacer) { spacer = document.createElement('div'); spacer.className = 'scroll-spacer'; spacer.setAttribute('aria-hidden', 'true'); }
    box.append(spacer); spacer.style.height = '0px';
    spacer.style.height = `${Math.max(0, box.clientHeight - (spacer.offsetTop - q.offsetTop) - 16)}px`;
  }
  function pinQuestion() {
    const box = $('#messages'); if (!box) return;
    const questions = box.querySelectorAll('.message-row.user'); const q = questions[questions.length - 1]; if (!q) return;
    box.dataset.pin = '1'; updateSpacer();
    box.scrollTo({ top: Math.max(0, q.offsetTop - 16), behavior: 'smooth' });
  }
  function paintLive() {
    frame = 0;
    if (!streaming || route.view !== 'chat' || route.chatId !== streaming.chatId) return;
    const box = $('#messages'); if (!box) return;
    let row = box.querySelector('.live-row');
    if (!row) {
      box.querySelector('.chat-empty')?.remove();
      box.querySelector('.scroll-spacer')?.remove();
      box.insertAdjacentHTML('beforeend', '<article class="message-row assistant live-row"><div class="message-avatar" aria-hidden="true">E</div><div class="message-content"><div class="message-author">EduCator</div><div class="message-bubble streaming"></div></div></article>');
      row = box.lastElementChild;
    }
    row.querySelector('.message-bubble').innerHTML = streaming.text ? md(streaming.text) : '<span class="typing-indicator"><i></i><i></i><i></i></span>';
    updateSpacer();
  }

  async function sendMessage(chat, text, attachments = []) {
    if (busy) { toast('Please wait for the current answer to finish.'); return; }
    const question = text || (attachments.length === 1 ? 'Please review the attached file and help me understand it.' : 'Please review the attached files and help me understand them.');
    const nb = chat.notebookId ? findNb(chat.notebookId) : null;
    if (!chat.messages.length && chat.title === 'New conversation') chat.title = titleFrom(text || attachments[0]?.name || 'Attached question');
    const userMessage = { role: 'user', text: question, attachments };
    chat.messages.push(userMessage); chat.updatedAt = Date.now();
    if (nb) { nb.lastStudiedAt = Date.now(); }
    save();
    if (route.view === 'chat' && route.chatId === chat.id) { $('#messages .chat-empty')?.remove(); appendMessage(userMessage); renderCrumbs(nb, chat, null); }
    renderSidebar(nb, chat);
    busy = true; document.querySelectorAll('.send-button').forEach((b) => { b.disabled = true; });
    streaming = { chatId: chat.id, text: '' }; paintLive(); pinQuestion();
    let answer = null;
    try {
      const history = chat.messages.slice(-30).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.text, attachments: (m.attachments || []).map((f) => ({ name: f.name, type: f.type, data: f.data, size: f.size })) }));
      const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, stream: true, context: nb ? notebookContext(nb, chat) : '' }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `The service returned an error (${response.status}).`); }
      const add = (t) => { streaming.text += t; if (!frame) frame = requestAnimationFrame(paintLive); };
      let failure = '';
      if ((response.headers.get('Content-Type') || '').includes('ndjson') && response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        const handle = (line) => { if (!line) return; let item; try { item = JSON.parse(line); } catch { return; } if (item.t) add(item.t); if (item.error) failure = item.error; };
        for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let nl; while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl).trim()); buffer = buffer.slice(nl + 1); } }
        handle(buffer.trim());
      } else {
        const data = await response.json().catch(() => ({})); if (typeof data.answer === 'string') add(data.answer);
      }
      if (!streaming.text.trim()) throw new Error(failure || 'No answer came back. Please try again.');
      answer = { role: 'assistant', text: streaming.text.trim() + (failure ? `\n\n_${failure}_` : ''), attachments: [] };
      chat.messages.push(answer);
    } catch (error) {
      answer = { role: 'assistant', error: true, text: error instanceof TypeError ? 'Could not reach the learning service. Check your connection and try again.' : error.message, attachments: [] };
    } finally {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      streaming = null; busy = false;
      chat.updatedAt = Date.now(); save();
      if (route.view === 'chat' && route.chatId === chat.id) {
        $('#messages .live-row')?.remove(); $('#messages .scroll-spacer')?.remove(); appendMessage(answer); updateSpacer();
      }
      document.querySelectorAll('.send-button').forEach((b) => { b.disabled = false; });
    }
  }

  // ---------- Notebook context + JSON generation ----------
  function notebookContext(nb, chat = null) {
    const lines = [`This conversation happens inside the learner's private notebook "${nb.name}", a long-term study space. Act as their ongoing personal tutor for this subject: build on what they have already covered, connect new ideas to their plan, and keep them moving toward their goal.`];
    if (nb.goal) lines.push(`Learner's goal: ${nb.goal}`);
    if (gradeLabel(nb)) lines.push(`Grade / level: ${gradeLabel(nb)}.`);
    if (nb.struggles) lines.push(`What they are struggling with: ${nb.struggles}`);
    lines.push(`Study pace: ${PACES[nb.pace] || nb.pace}.`);
    if (nb.deadline) lines.push(`Target date: ${nb.deadline}.`);
    if (nb.plan) {
      lines.push(`Learning plan "${nb.plan.title}":`);
      nb.plan.lessons.forEach((l, i) => lines.push(`${i + 1}. ${l.title}${l.done ? ' — completed' : ''}`));
      const next = nb.plan.lessons.find((l) => !l.done);
      if (next) lines.push(`Next lesson to study: ${next.title}.`);
    }
    const dg = diagnosticSummary(nb);
    if (dg?.assessment) lines.push(`Diagnostic (${dg.attempt.score}/${dg.attempt.total}). ${assessmentText(dg.assessment)}`);
    const { attempts } = quizStats(nb);
    if (attempts.length) {
      lines.push('Recent quiz results:');
      for (const a of attempts.slice(0, 4)) {
        lines.push(`- "${a.quiz.title}": ${a.score}/${a.total}`);
        a.quiz.questions.forEach((q, i) => { if (a.answers[i] !== q.answer) lines.push(`  missed: ${q.question.replace(/\s+/g, ' ').slice(0, 140)}`); });
      }
    }
    const lesson = lessonOf(nb, chat);
    if (lesson) lines.push(`This session is Lesson ${lesson.index + 1}: "${lesson.lesson.title}". Summary: ${lesson.lesson.summary} Objectives: ${lesson.lesson.objectives.join('; ')}. Teach interactively: explain in small steps, use examples, check understanding with a question before moving on, and finish with a short recap.`);
    return lines.join('\n').slice(0, 5800);
  }

  async function generateJSON(prompt, context) {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: prompt }], format: 'json', context }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The service returned an error (${response.status}).`);
    let raw = String(data.answer || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('The tutor sent back something unexpected. Please try again.');
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error('The tutor sent back something unexpected. Please try again.'); }
  }
  const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const oneLine = (t, max = 220) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);
  function diagnosticDetail(quiz, attempt) {
    return quiz.questions.map((q, i) => {
      const mine = attempt.answers[i], ok = mine === q.answer;
      return `Q${i + 1} [${ok ? 'correct' : 'WRONG'}]: ${oneLine(q.question)}\n   my answer: ${oneLine(q.choices[mine] ?? '(none)', 120)}${ok ? '' : ` | correct answer: ${oneLine(q.choices[q.answer], 120)}`}`;
    }).join('\n');
  }
  function assessmentText(a) {
    if (!a) return '';
    return [`Tutor's assessment: ${a.headline}`, a.summary, a.strengths.length ? `Strengths: ${a.strengths.join('; ')}` : '', a.gaps.length ? `Gaps to work on: ${a.gaps.join('; ')}` : '', a.patterns.length ? `Patterns in mistakes: ${a.patterns.join('; ')}` : '', a.startingPoint ? `Recommended starting point: ${a.startingPoint}` : ''].filter(Boolean).join('\n');
  }

  // After a diagnostic, compare the results with what the learner said about themselves.
  function assessmentPrompt(nb, quiz, attempt) {
    return `I just finished a diagnostic quiz for my notebook "${nb.name}". Please assess where I am right now.

What I told you when I set up the notebook:
- Grade / level: ${gradeLabel(nb) || 'Not specified'}
- What I'm struggling with: ${nb.struggles || 'Not specified'}
- My goal: ${nb.goal || 'Not specified'}

My diagnostic score: ${attempt.score}/${attempt.total}. Question by question (ordered roughly from easier to harder):
${diagnosticDetail(quiz, attempt)}

Compare my actual results with what I said I struggle with: where do they match, and where do they differ (for example, I may be stronger than I think in one area, or have a gap I didn't mention)? Look for patterns across my wrong answers (a shared misconception, a skill that keeps tripping me up, or a point where the difficulty breaks down).

Return JSON with exactly this shape:
{"headline": string (one short, encouraging sentence summing up where I am), "summary": string (2-4 sentences speaking directly to me as my tutor: honest, warm, and specific, comparing my results with what I told you), "selfReport": "matches" | "partly" | "differs", "strengths": [1-3 short strings], "gaps": [1-4 short strings naming specific skills or concepts], "patterns": [0-3 short strings describing patterns in my mistakes], "startingPoint": string (one sentence on where my learning plan should start)}
Describe skills and concepts; do not just list the questions.`;
  }
  function normalizeAssessment(d) {
    const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => str(x, 240)).filter(Boolean).slice(0, n);
    const headline = str(d?.headline, 200), summary = str(d?.summary, 1200);
    if (!headline && !summary) return null;
    return { headline, summary, selfReport: ['matches', 'partly', 'differs'].includes(d?.selfReport) ? d.selfReport : '', strengths: list(d?.strengths, 3), gaps: list(d?.gaps, 4), patterns: list(d?.patterns, 3), startingPoint: str(d?.startingPoint, 300), at: Date.now() };
  }
  async function assessDiagnostic(nb, quiz) {
    const attempt = quiz.attempts[quiz.attempts.length - 1]; if (!attempt) return;
    const key = `assess:${quiz.id}`; if (jobs[key]) return;
    jobs[key] = true; delete jobErrors[key]; refreshIf(nb.id);
    try {
      const assessment = normalizeAssessment(await generateJSON(assessmentPrompt(nb, quiz, attempt), notebookContext({ ...nb, plan: null, quizzes: [] })));
      if (!assessment) throw new Error('Your tutor could not review the results. Please try again.');
      attempt.assessment = assessment; save();
    } catch (e) { jobErrors[key] = e.message; }
    finally { delete jobs[key]; refreshIf(nb.id); }
  }

  function planPrompt(nb) {
    const d = diagnosticSummary(nb);
    return `Create a personalised learning plan for my notebook "${nb.name}".
Grade / level: ${gradeLabel(nb) || 'Not specified'}
What I'm struggling with: ${nb.struggles || 'Not specified'}
Goal: ${nb.goal || `Build a solid understanding of ${nb.name}.`}
Time I can study: ${PACES[nb.pace]}${nb.deadline ? `\nI'm working toward: ${nb.deadline}` : ''}
${d ? `Diagnostic result: ${d.attempt.score}/${d.attempt.total}. Question by question (ordered roughly from easier to harder):\n${diagnosticDetail(d.quiz, d.attempt)}${d.assessment ? `\n\n${assessmentText(d.assessment)}` : ''}` : 'No diagnostic taken yet.'}

Return JSON with exactly this shape:
{"title": string, "overview": string (2-3 sentences explaining the approach), "lessons": [{"title": string, "summary": string (1-2 sentences), "objectives": [3-4 short strings], "minutes": number (estimated study time)}]}
Use 6 to 10 lessons, ordered from foundations to mastery.${d ? `
- Start where my diagnostic shows my understanding breaks down, not at the very beginning. Shorten or combine topics I clearly already know into a quick review.
- Give each gap and mistake pattern from my diagnostic its own lesson or a clear objective, and revisit the biggest gap again later in the plan.
- Where my results differ from what I said I struggle with, trust the results, but still address what I said worries me.
- In the overview, tell me in 2-3 sentences how the plan responds to my diagnostic results.` : `
- Start at the right point for my grade, spend extra time on what I'm struggling with, and include an early checkpoint.`}
- Make lesson titles short and specific, and write objectives as things I'll be able to do.`;
  }
  function normalizePlan(data) {
    const lessons = (Array.isArray(data?.lessons) ? data.lessons : []).map((l) => ({
      id: uid(), title: str(l?.title, 120), summary: str(l?.summary), done: false, doneAt: 0,
      objectives: (Array.isArray(l?.objectives) ? l.objectives : []).map((o) => str(o, 200)).filter(Boolean).slice(0, 6),
      minutes: Math.max(5, Math.min(240, Math.round(Number(l?.minutes) || 30)))
    })).filter((l) => l.title).slice(0, 14);
    if (lessons.length < 2) return null;
    return { title: str(data.title, 120) || 'Learning plan', overview: str(data.overview, 1200), lessons, createdAt: Date.now() };
  }
  async function generatePlan(nb) {
    const key = `plan:${nb.id}`; if (jobs[key]) return;
    jobs[key] = true; delete jobErrors[key]; refreshIf(nb.id);
    try {
      const plan = normalizePlan(await generateJSON(planPrompt(nb), notebookContext({ ...nb, plan: null })));
      if (!plan) throw new Error('The plan came back incomplete. Please try again.');
      // Keep completion state for lessons whose titles match the previous plan.
      const doneTitles = new Set((nb.plan?.lessons || []).filter((l) => l.done).map((l) => l.title.toLowerCase()));
      plan.lessons.forEach((l) => { if (doneTitles.has(l.title.toLowerCase())) { l.done = true; l.doneAt = Date.now(); } });
      nb.plan = plan; nb.updatedAt = Date.now(); save();
      toast(`Your ${nb.name} learning plan is ready.`);
    } catch (e) { jobErrors[key] = e.message; toast(e.message); }
    finally { delete jobs[key]; refreshIf(nb.id); }
  }

  function quizPrompt(nb, { lessonId, count, difficulty, kind }) {
    const lesson = nb.plan?.lessons.find((l) => l.id === lessonId);
    const scope = kind === 'diagnostic'
      ? `a diagnostic quiz for "${nb.name}" at the ${gradeLabel(nb) || 'appropriate'} level that ranges from easy to hard, so we can find my real starting point${nb.struggles ? `. Include several questions on what I say I struggle with: ${nb.struggles}` : ''}`
      : lesson ? `a quiz on the lesson "${lesson.title}" (${lesson.summary} Objectives: ${lesson.objectives.join('; ')})`
      : `a review quiz covering my notebook "${nb.name}"${nb.plan ? ', focusing on completed lessons and the next lesson' : ''}`;
    return `Create ${scope}.
Number of questions: ${count}. Difficulty: ${DIFFICULTIES[difficulty] || 'Just right'} for my level.
Return JSON with exactly this shape:
{"title": string (short), "questions": [{"question": string, "choices": [4 strings], "answer": number (0-based index of the single correct choice), "explanation": string (1-3 sentences on why the answer is right)}]}
Mix question types (concepts, applying ideas, common misconceptions). Vary which position holds the correct answer. Avoid "all of the above".`;
  }
  function normalizeQuiz(data, opts) {
    const questions = (Array.isArray(data?.questions) ? data.questions : []).map((q) => {
      const choices = (Array.isArray(q?.choices) ? q.choices : []).map((c) => str(String(c ?? ''), 300)).filter(Boolean).slice(0, 6);
      const answer = Number(q?.answer);
      return { question: str(q?.question, 800), choices, answer, explanation: str(q?.explanation, 800) };
    }).filter((q) => q.question && q.choices.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length);
    if (!questions.length) return null;
    return { id: uid(), title: str(data.title, 100) || (opts.kind === 'diagnostic' ? 'Diagnostic check' : 'Quiz'), kind: opts.kind, lessonId: opts.lessonId || '', difficulty: opts.difficulty, createdAt: Date.now(), questions, attempts: [], progress: { answers: [], revealed: false } };
  }
  async function generateQuiz(nb, opts) {
    const key = `quiz:${nb.id}`; if (jobs[key]) { toast('A quiz is already being created.'); return; }
    jobs[key] = opts; delete jobErrors[key];
    if (!(route.nbId === nb.id && route.view === 'nb-quizzes')) go(`#/nb/${nb.id}/quizzes`); else render(true);
    try {
      const quiz = normalizeQuiz(await generateJSON(quizPrompt(nb, opts), notebookContext(nb)), opts);
      if (!quiz) throw new Error('The quiz came back incomplete. Please try again.');
      nb.quizzes.unshift(quiz); nb.updatedAt = Date.now(); save();
      delete jobs[key];
      if (route.nbId === nb.id && route.view === 'nb-quizzes') go(`#/nb/${nb.id}/quiz/${quiz.id}`); else { toast(`Your quiz "${quiz.title}" is ready.`); refreshIf(nb.id); }
    } catch (e) { delete jobs[key]; jobErrors[key] = e.message; toast(e.message); refreshIf(nb.id); }
  }

  // ---------- Views: general ----------
  function notebookCard(nb) {
    const p = nbProgress(nb), { avg } = quizStats(nb);
    return `<a class="nb-card" href="#/nb/${nb.id}" style="--nb:${colorHex(nb.color)}">
      <div class="nb-card-top"><span class="nb-icon lg">${esc(nb.icon)}</span><span class="nb-card-when">${nb.lastStudiedAt ? `Studied ${timeAgo(nb.lastStudiedAt).toLowerCase()}` : 'New'}</span></div>
      <h3>${esc(nb.name)}</h3><p>${esc(nb.goal || 'A private space for long-term learning.')}</p>
      <div class="progress"><i style="width:${p.pct}%"></i></div>
      <div class="nb-card-stats"><span>${p.total ? `${p.done}/${p.total} lessons` : 'No plan yet'}</span><span>${avg === null ? 'No quizzes yet' : `Quiz avg ${avg}%`}</span></div></a>`;
  }
  function viewHome() {
    const starters = [
      ['💡', 'Explain a concept', 'Can you explain a concept to me step by step? Ask me what I want to understand first.'],
      ['📸', 'Check my homework', 'I\'ll attach a photo of my homework. Please check my work and explain any mistakes without just giving me the answers.'],
      ['📝', 'Prepare for a test', 'Help me prepare for an upcoming test. Ask me what it covers and when it is, then make a short study plan.'],
      ['🗣️', 'Practice a language', 'Let\'s practice a language conversation. Ask me which language and my level, then start a simple conversation.']
    ];
    el.view.innerHTML = `<div class="page home">
      <header class="page-hero"><div class="welcome-back"><span class="eyebrow">Your study space</span><span aria-hidden="true">✳</span></div><h1>What are we<br><em>figuring out</em> today?</h1>
        <p class="lead">Pick a subject to start a notebook, or ask your own question.</p></header>
      <div class="topic-grid">${Object.entries(TEMPLATES).map(([key, t]) => `<button type="button" class="topic-card topic-${t.tint}" data-action="template" data-key="${key}"><span class="topic-emoji">${t.glyph}</span><span class="topic-title">${t.title}</span><span class="topic-caption">${t.caption}</span><span class="topic-cta">Start a notebook →</span></button>`).join('')}</div>
      ${composer('home', 'Ask anything you\'re curious about…', { big: true })}
      <div class="starter-row">${starters.map(([icon, label, prompt]) => `<button type="button" class="starter" data-action="starter" data-prompt="${esc(prompt)}"><span>${icon}</span>${label}</button>`).join('')}</div>
      <section class="home-section">
        <div class="section-head"><div><h2>Your notebooks</h2><p>Private study spaces with a learning plan, lessons, and quizzes.</p></div><a class="btn btn-soft" href="#/notebooks/new">＋ New notebook</a></div>
        ${notebooks.length ? `<div class="nb-grid">${notebooks.map(notebookCard).join('')}</div>` : `
        <div class="nb-intro">
          <div class="nb-step tint-lilac"><span>01</span><strong>Set a goal</strong><small>Tell us your level and how much time you have.</small></div>
          <div class="nb-step tint-mint"><span>02</span><strong>Get a plan</strong><small>Lessons ordered from basics to mastery.</small></div>
          <div class="nb-step tint-peach"><span>03</span><strong>Learn lessons</strong><small>A tutor that remembers your progress.</small></div>
          <div class="nb-step tint-blue"><span>04</span><strong>Take quizzes</strong><small>Explanations for every answer.</small></div>
        </div>`}
      </section></div>`;
    $('#composer-home').focus({ preventScroll: true });
  }

  function viewNotebookForm(nb) {
    const t = nb || draftTemplate || {};
    draftTemplate = null;
    const isNew = !nb;
    const v = { name: nb?.name || '', icon: t.icon || ICONS[0], color: t.color || COLORS[0].id, grade: nb?.grade || '', struggles: nb?.struggles || '', goal: nb?.goal || '', pace: nb?.pace || 'steady', deadline: nb?.deadline || '' };
    const radios = (name, options, current) => Object.entries(options).map(([value, label]) => `<label class="pill"><input type="radio" name="${name}" value="${value}"${value === current ? ' checked' : ''}><span>${label}</span></label>`).join('');
    const fWhat = `
        <fieldset class="field"><legend>What grade or level are you at?</legend><div class="pills">${radios('grade', GRADES, v.grade)}</div></fieldset>
        <div class="field"><label for="nbName">What subject or course is it?</label><input id="nbName" name="name" maxlength="60" placeholder="${esc(t.placeholder || 'e.g. Algebra 1, AP Biology, Spanish 2')}" value="${esc(v.name)}"></div>
        <div class="field-row">
          <fieldset class="field"><legend>Icon</legend><div class="icon-picker">${ICONS.map((i) => `<label><input type="radio" name="icon" value="${i}"${i === v.icon ? ' checked' : ''}><span>${i}</span></label>`).join('')}</div></fieldset>
          <fieldset class="field"><legend>Color</legend><div class="color-picker">${COLORS.map((c) => `<label title="${c.id}"><input type="radio" name="color" value="${c.id}"${c.id === v.color ? ' checked' : ''}><span style="--c:${c.hex}"></span></label>`).join('')}</div></fieldset>
        </div>`;
    const fStuck = `
        <div class="field"><label for="nbStruggles">What part are you struggling with?</label><textarea id="nbStruggles" name="struggles" rows="3" maxlength="600" placeholder="e.g. Word problems, and I always mix up when to use the quadratic formula.">${esc(v.struggles)}</textarea></div>
        <div class="field"><label for="nbGoal">What do you want to be able to do? <small>(optional)</small></label><textarea id="nbGoal" name="goal" rows="2" maxlength="600" placeholder="e.g. Pass my unit test, or feel confident doing homework on my own.">${esc(v.goal)}</textarea></div>
        <fieldset class="field"><legend>How much time can you study?</legend><div class="pills">${radios('pace', PACES, v.pace)}</div></fieldset>
        <div class="field"><label for="nbDeadline">Working toward a test or date? <small>(optional)</small></label><input id="nbDeadline" name="deadline" type="date" value="${esc(v.deadline)}"></div>`;
    if (!isNew) {
      el.view.innerHTML = `<div class="page narrow">
        <header class="page-hero"><span class="eyebrow">Notebook settings</span><h1>Edit <em>${esc(nb.name)}</em></h1>
          <p class="lead">Your tutor uses these details in every session. Regenerate the plan to apply changes to your lessons.</p></header>
        <form class="card form" data-form="notebook">${fWhat}${fStuck}
          <div class="form-actions"><button type="button" class="btn btn-danger-ghost" data-action="delete-notebook">Delete notebook</button><button class="btn btn-primary btn-lg" type="submit" value="save">Save changes</button></div>
        </form></div>`;
      return;
    }
    el.view.innerHTML = `<div class="page narrow">
      <header class="page-hero"><span class="eyebrow">New notebook</span><h1>Let's set up your <em>study space</em></h1>
        <p class="lead">A few quick questions so your tutor can meet you where you are.</p></header>
      <form class="card form wizard" data-form="notebook" data-step="1" novalidate>
        <ol class="wizard-steps" aria-hidden="true"><li class="on">Your subject</li><li>Where you're stuck</li><li>Starting point</li></ol>
        <section class="wizard-step" data-step="1"><h3>What are you studying?</h3>${fWhat}
          <div class="form-actions"><a class="btn btn-ghost" href="#/">Cancel</a><button type="button" class="btn btn-primary btn-lg" data-action="wiz-next">Next →</button></div></section>
        <section class="wizard-step" data-step="2" hidden><h3>Where are you getting stuck?</h3>${fStuck}
          <div class="form-actions"><button type="button" class="btn btn-ghost" data-action="wiz-back">← Back</button><button type="button" class="btn btn-primary btn-lg" data-action="wiz-next">Next →</button></div></section>
        <section class="wizard-step" data-step="3" hidden><h3>Let's find your starting point</h3>
          <div class="recommend"><span class="recommend-badge">Recommended</span><strong>Take a quick diagnostic first</strong>
            <p>8 questions, from easy to harder, including the parts you said are tricky. Your results tell your tutor what you already know, so your learning plan starts in the right place instead of guessing.</p>
            <button class="btn btn-primary btn-lg" type="submit" value="diagnostic">✦ Start the diagnostic</button></div>
          <div class="form-actions spread"><button type="button" class="btn btn-ghost" data-action="wiz-back">← Back</button>
            <span class="alt-actions"><button class="btn btn-soft" type="submit" value="plan">Skip, build my plan now</button><button class="btn btn-ghost" type="submit" value="none">Just create the notebook</button></span></div></section>
      </form></div>`;
    $('input[name="grade"]')?.focus({ preventScroll: true });
  }
  function wizardStep(form, step) {
    form.dataset.step = step;
    form.querySelectorAll('.wizard-step').forEach((sec) => { sec.hidden = sec.dataset.step !== String(step); });
    form.querySelectorAll('.wizard-steps li').forEach((li, i) => li.classList.toggle('on', i < step));
    el.view.scrollTop = 0;
  }
  function validateStep(form, step) {
    if (step === 1) {
      if (!form.querySelector('input[name="grade"]:checked')) { toast('Pick your grade or level.'); form.querySelector('input[name="grade"]').focus(); return false; }
      if (!form.querySelector('#nbName').value.trim()) { toast('Tell us the subject or course.'); form.querySelector('#nbName').focus(); return false; }
    }
    if (step === 2 && !form.querySelector('#nbStruggles').value.trim()) { toast('Tell us what part you’re struggling with. Even a few words helps.'); form.querySelector('#nbStruggles').focus(); return false; }
    return true;
  }

  // ---------- Views: notebook ----------
  function nextLessonCard(nb) {
    const key = `plan:${nb.id}`;
    if (jobs[key]) return `<div class="card next-up loading"><div class="spinner"></div><div><h3>Building your learning plan…</h3><p>Your tutor is designing lessons around your goal and level. This usually takes 10–30 seconds.</p></div></div>`;
    if (!nb.plan) {
      const err = jobErrors[key] ? `<p class="error-text">${esc(jobErrors[key])}</p>` : '';
      const diag = diagnosticOf(nb), done = diagnosticSummary(nb);
      if (jobs[`quiz:${nb.id}`]) return `<div class="card next-up loading"><div class="spinner"></div><div><h3>Writing your diagnostic…</h3><p>This usually takes 10–20 seconds.</p></div></div>`;
      if (done) return `<div class="card next-up"><div><span class="eyebrow">Diagnostic done · ${done.attempt.score}/${done.attempt.total}</span><h3>Build your learning plan</h3><p>${done.assessment ? `${esc(done.assessment.headline)} ` : ''}Your plan will start where your diagnostic says you are and focus on what you're struggling with.</p>${err}</div><button type="button" class="btn btn-primary btn-lg" data-action="generate-plan">✦ Build my plan</button></div>`;
      if (diag) return `<div class="card next-up"><div><span class="eyebrow">Step 1</span><h3>Finish your diagnostic</h3><p>You're partway through. Finish it so your plan starts in the right place.</p></div><a class="btn btn-primary btn-lg" href="#/nb/${nb.id}/quiz/${diag.id}">Continue diagnostic →</a></div>`;
      return `<div class="card next-up"><div><span class="eyebrow">Recommended first step</span><h3>Take a quick diagnostic</h3><p>8 questions to find what you already know, so your learning plan starts in the right place.</p>${err}</div>
        <div class="next-up-actions"><button type="button" class="btn btn-primary btn-lg" data-action="diagnostic">✦ Start diagnostic</button><button type="button" class="btn btn-ghost" data-action="generate-plan">Skip, build my plan</button></div></div>`;
    }
    const i = nb.plan.lessons.findIndex((l) => !l.done);
    if (i < 0) return `<div class="card next-up done"><div><span class="eyebrow">Plan complete 🎉</span><h3>You finished every lesson!</h3><p>Lock it in with a final review quiz, or extend your plan with a new goal.</p></div><button type="button" class="btn btn-primary btn-lg" data-action="quick-quiz" data-count="10">Take a final review</button></div>`;
    const l = nb.plan.lessons[i], existing = chats.find((c) => c.lessonId === l.id);
    return `<div class="card next-up"><div><span class="eyebrow">Up next · Lesson ${i + 1} of ${nb.plan.lessons.length} · ~${l.minutes} min</span><h3>${esc(l.title)}</h3><p>${esc(l.summary)}</p></div>
      <button type="button" class="btn btn-primary btn-lg" data-action="start-lesson" data-id="${l.id}">${existing ? 'Continue lesson →' : 'Start lesson →'}</button></div>`;
  }
  function viewOverview(nb) {
    const p = nbProgress(nb), { attempts, avg } = quizStats(nb), sessions = nbChats(nb);
    el.view.innerHTML = `<div class="page">
      <header class="nb-hero"><span class="nb-icon xl">${esc(nb.icon)}</span><div class="nb-hero-copy"><span class="eyebrow">Notebook</span><h1>${esc(nb.name)}</h1>${nb.goal ? `<p class="lead">${esc(nb.goal)}</p>` : ''}
        ${nb.struggles ? `<p class="struggles"><strong>Working on:</strong> ${esc(nb.struggles)}</p>` : ''}<div class="tags">${gradeLabel(nb) ? `<span>${esc(gradeLabel(nb))}</span>` : ''}<span>${esc(PACES[nb.pace])}</span>${nb.deadline ? `<span>🎯 ${esc(new Date(nb.deadline + 'T00:00').toLocaleDateString())}</span>` : ''}</div></div>
        <a class="btn btn-ghost" href="#/nb/${nb.id}/settings">Edit</a></header>
      <div class="stat-grid">
        <div class="stat tint-lilac"><span>Lessons</span><strong>${p.total ? `${p.done}<small>/${p.total}</small>` : '–'}</strong><div class="progress"><i style="width:${p.pct}%"></i></div></div>
        <div class="stat tint-mint"><span>Quiz average</span><strong>${avg === null ? '–' : `${avg}<small>%</small>`}</strong><em>${plural(attempts.length, 'attempt')}</em></div>
        <div class="stat tint-peach"><span>Sessions</span><strong>${sessions.length}</strong><em>chats in this notebook</em></div>
        <div class="stat tint-blue"><span>Last studied</span><strong class="stat-text">${timeAgo(nb.lastStudiedAt)}</strong></div>
      </div>
      ${nextLessonCard(nb)}
      <div class="action-grid">
        <button type="button" class="action-card tint-lilac" data-action="quick-quiz"><span>✦</span><strong>Quiz me</strong><small>5 questions on what I've studied</small></button>
        <button type="button" class="action-card tint-mint" data-action="diagnostic"><span>◎</span><strong>Diagnostic check</strong><small>Find my real starting level</small></button>
        <a class="action-card tint-peach" href="#/nb/${nb.id}/sessions"><span>✎</span><strong>Ask my tutor</strong><small>Open a free-form session</small></a>
      </div>
      <div class="two-col">
        <section class="card"><div class="card-head"><h3>Recent sessions</h3><a href="#/nb/${nb.id}/sessions">All</a></div>
          ${sessions.slice(0, 5).map((c) => `<a class="list-row" href="#/nb/${nb.id}/chat/${c.id}"><span>${c.lessonId ? '📘' : '💬'}</span><span class="list-title">${esc(c.title)}</span><small>${timeAgo(c.updatedAt)}</small></a>`).join('') || '<p class="muted">No sessions yet. Start a lesson or ask your tutor anything.</p>'}</section>
        <section class="card"><div class="card-head"><h3>Recent quiz results</h3><a href="#/nb/${nb.id}/quizzes">All</a></div>
          ${attempts.slice(0, 5).map((a) => `<a class="list-row" href="#/nb/${nb.id}/quiz/${a.quiz.id}"><span class="score-dot ${scoreClass(a.score / a.total)}">${Math.round(a.score / a.total * 100)}%</span><span class="list-title">${esc(a.quiz.title)}</span><small>${timeAgo(a.at)}</small></a>`).join('') || '<p class="muted">No quizzes taken yet.</p>'}</section>
      </div></div>`;
  }
  const SELF_REPORT = { matches: 'Matches what you told me', partly: 'Partly matches what you told me', differs: 'Different from what you expected' };
  function assessmentHtml(nb, quiz, attempt) {
    const key = `assess:${quiz.id}`;
    if (jobs[key]) return `<div class="assessment loading"><div class="spinner"></div><div><strong>Your tutor is reviewing your answers…</strong><p>Comparing your results with what you told us about ${esc(nb.name)}.</p></div></div>`;
    const as = attempt.assessment;
    if (!as) return `<div class="assessment empty"><p>${jobErrors[key] ? esc(jobErrors[key]) : 'Get your tutor’s take on these results.'}</p><button type="button" class="btn btn-soft" data-action="retry-assessment">${jobErrors[key] ? 'Try again' : 'Review my results'}</button></div>`;
    const list = (title, items, cls) => (items.length ? `<div class="assess-list ${cls}"><h4>${title}</h4><ul>${items.map((x) => `<li>${mdInline(x)}</li>`).join('')}</ul></div>` : '');
    return `<div class="assessment">
      <div class="assess-head"><span class="assess-avatar" aria-hidden="true">E</span><div><span class="eyebrow">Your tutor's take</span><strong>${esc(as.headline)}</strong></div></div>
      ${as.selfReport ? `<span class="assess-badge ${as.selfReport}">${SELF_REPORT[as.selfReport]}</span>` : ''}
      <div class="md assess-summary">${md(as.summary)}</div>
      <div class="assess-grid">${list('Already strong', as.strengths, 'good')}${list('Let’s work on', as.gaps, 'gap')}</div>
      ${list('Patterns I noticed', as.patterns, 'pattern')}
      ${as.startingPoint ? `<p class="assess-start"><strong>Where we’ll start:</strong> ${mdInline(as.startingPoint)}</p>` : ''}
    </div>`;
  }
  const scoreClass = (r) => (r >= 0.8 ? 'good' : r >= 0.5 ? 'ok' : 'low');

  function viewPlan(nb) {
    const key = `plan:${nb.id}`;
    if (!nb.plan || jobs[key]) {
      el.view.innerHTML = `<div class="page narrow"><header class="page-hero"><span class="eyebrow">Learning plan</span><h1>${esc(nb.icon)} ${esc(nb.name)}</h1></header>${nextLessonCard(nb)}</div>`;
      return;
    }
    const p = nbProgress(nb);
    el.view.innerHTML = `<div class="page narrow">
      <header class="page-hero"><span class="eyebrow">Learning plan · ${p.done} of ${p.total} complete</span><h1>${esc(nb.plan.title)}</h1>${nb.plan.overview ? `<div class="lead md">${md(nb.plan.overview)}</div>` : ''}
        <div class="progress lg"><i style="width:${p.pct}%"></i></div>
        <div class="hero-actions"><button type="button" class="btn btn-ghost" data-action="regenerate-plan">↻ Regenerate plan</button></div></header>
      <ol class="lesson-list">${nb.plan.lessons.map((l, i) => {
        const session = chats.find((c) => c.lessonId === l.id);
        return `<li class="lesson${l.done ? ' done' : ''}">
          <button type="button" class="lesson-check" data-action="toggle-lesson" data-id="${l.id}" aria-pressed="${l.done}" aria-label="${l.done ? 'Mark lesson as not done' : 'Mark lesson complete'}">${l.done ? '✓' : i + 1}</button>
          <div class="lesson-body"><div class="lesson-meta"><span>Lesson ${i + 1}</span><span>~${l.minutes} min</span>${l.done ? '<span class="done-tag">Completed</span>' : ''}</div>
            <h3>${esc(l.title)}</h3><p>${esc(l.summary)}</p>
            ${l.objectives.length ? `<ul class="objectives">${l.objectives.map((o) => `<li>${mdInline(o)}</li>`).join('')}</ul>` : ''}
            <div class="lesson-actions"><button type="button" class="btn ${l.done ? 'btn-soft' : 'btn-primary'}" data-action="start-lesson" data-id="${l.id}">${session ? (l.done ? 'Review lesson' : 'Continue lesson') : 'Start lesson'} →</button>
              <button type="button" class="btn btn-ghost" data-action="lesson-quiz" data-id="${l.id}">Quiz me on this</button></div></div></li>`;
      }).join('')}</ol></div>`;
  }

  function viewQuizzes(nb) {
    const key = `quiz:${nb.id}`, job = jobs[key];
    const lessons = nb.plan?.lessons || [];
    el.view.innerHTML = `<div class="page narrow">
      <header class="page-hero"><span class="eyebrow">Quizzes</span><h1>Test what you <em>know</em></h1><p class="lead">Quizzes are generated for your level and plan. Each answer is explained, and your tutor uses your results to focus future sessions.</p></header>
      ${job ? `<div class="card next-up loading"><div class="spinner"></div><div><h3>Writing your quiz…</h3><p>Creating ${job.count} questions${job.kind === 'diagnostic' ? ' to check your level' : ''}. This usually takes 10–20 seconds.</p></div></div>` : `
      <form class="card form quiz-gen" data-form="quiz">
        <h3>New quiz</h3>
        <div class="field-row three">
          <div class="field"><label for="qScope">Topic</label><select id="qScope" name="scope"><option value="">Everything so far</option><option value="diagnostic">Diagnostic (find my level)</option>${lessons.map((l, i) => `<option value="${l.id}">Lesson ${i + 1}: ${esc(l.title)}</option>`).join('')}</select></div>
          <div class="field"><label for="qCount">Questions</label><select id="qCount" name="count"><option>5</option><option selected>8</option><option>10</option></select></div>
          <div class="field"><label for="qDiff">Difficulty</label><select id="qDiff" name="difficulty">${Object.entries(DIFFICULTIES).map(([k, v]) => `<option value="${k}"${k === 'matched' ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        ${jobErrors[key] ? `<p class="error-text">${esc(jobErrors[key])}</p>` : ''}
        <div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">✦ Generate quiz</button></div>
      </form>`}
      <div class="quiz-list">${nb.quizzes.map((q) => {
        const best = q.attempts.length ? Math.max(...q.attempts.map((a) => a.score / a.total)) : null;
        const lesson = lessons.find((l) => l.id === q.lessonId);
        return `<div class="quiz-row"><a href="#/nb/${nb.id}/quiz/${q.id}" class="quiz-row-main">
          <span class="score-dot ${best === null ? 'none' : scoreClass(best)}">${best === null ? '–' : `${Math.round(best * 100)}%`}</span>
          <span><strong>${esc(q.title)}</strong><small>${plural(q.questions.length, 'question')} · ${q.kind === 'diagnostic' ? 'Diagnostic' : lesson ? esc(lesson.title) : 'Review'} · ${q.progress ? 'In progress' : plural(q.attempts.length, 'attempt')} · ${timeAgo(q.createdAt)}</small></span></a>
          <button type="button" class="sb-icon danger" data-action="delete-quiz" data-id="${q.id}" aria-label="Delete quiz" title="Delete quiz">×</button></div>`;
      }).join('') || '<p class="muted center">No quizzes yet. Generate one above.</p>'}</div></div>`;
  }

  function viewSessions(nb) {
    const sessions = nbChats(nb);
    el.view.innerHTML = `<div class="page narrow">
      <header class="page-hero"><span class="eyebrow">Sessions</span><h1>Ask your <em>${esc(nb.name)}</em> tutor</h1><p class="lead">Sessions are private to this notebook. Your tutor knows your goal, plan, and quiz results.</p></header>
      ${composer('nb-new', `Start a new ${nb.name} session…`, { big: true })}
      <div class="card"><div class="card-head"><h3>All sessions</h3><span class="muted">${sessions.length}</span></div>
        ${sessions.map((c) => `<a class="list-row" href="#/nb/${nb.id}/chat/${c.id}"><span>${c.lessonId ? '📘' : '💬'}</span><span class="list-title">${esc(c.title)}</span><small>${plural(c.messages.filter((m) => m.role === 'user').length, 'message')} · ${timeAgo(c.updatedAt)}</small></a>`).join('') || '<p class="muted">No sessions yet.</p>'}</div></div>`;
    $('#composer-nb-new').focus({ preventScroll: true });
  }

  function viewQuiz(nb, quiz) {
    const total = quiz.questions.length;
    if (!quiz.progress && !quiz.attempts.length) quiz.progress = { answers: [], revealed: false };
    if (quiz.progress) {
      const pr = quiz.progress;
      const index = pr.answers.length - (pr.revealed ? 1 : 0);
      const q = quiz.questions[index];
      const picked = pr.revealed ? pr.answers[index] : null;
      const correctSoFar = pr.answers.filter((a, i) => (pr.revealed || i < pr.answers.length) && a === quiz.questions[i].answer).length;
      el.view.innerHTML = `<div class="page narrow quiz-page">
        <div class="quiz-top"><a class="btn btn-ghost btn-sm" href="#/nb/${nb.id}/quizzes">← Quizzes</a><span class="muted">Question ${index + 1} of ${total} · ${correctSoFar} correct</span></div>
        <div class="progress lg"><i style="width:${Math.round((index + (pr.revealed ? 1 : 0)) / total * 100)}%"></i></div>
        <div class="card quiz-card"><span class="eyebrow">${esc(quiz.title)}</span><div class="quiz-question md">${md(q.question)}</div>
          <div class="choices">${q.choices.map((c, i) => {
            const state = picked === null ? '' : i === q.answer ? ' correct' : i === picked ? ' wrong' : ' dim';
            return `<button type="button" class="choice${state}" data-action="answer" data-index="${i}"${picked !== null ? ' disabled' : ''}><span class="choice-key">${'ABCDEF'[i]}</span><span class="choice-text">${mdInline(c)}</span></button>`;
          }).join('')}</div>
          ${picked !== null ? `<div class="feedback ${picked === q.answer ? 'good' : 'bad'}"><strong>${picked === q.answer ? '✓ Correct!' : '✗ Not quite.'}</strong>${q.explanation ? `<div class="md">${md(q.explanation)}</div>` : ''}</div>
          <div class="form-actions"><button type="button" class="btn btn-primary btn-lg" data-action="next-question">${index + 1 === total ? 'See results' : 'Next question →'}</button></div>` : '<p class="muted small">Tip: press 1–4 to pick an answer.</p>'}
        </div></div>`;
      return;
    }
    const a = quiz.attempts[quiz.attempts.length - 1], ratio = a.score / a.total;
    const missed = quiz.questions.map((q, i) => ({ q, i, mine: a.answers[i] })).filter((x) => x.mine !== x.q.answer);
    const assessing = quiz.kind === 'diagnostic' && !!jobs[`assess:${quiz.id}`];
    el.view.innerHTML = `<div class="page narrow quiz-page">
      <div class="quiz-top"><a class="btn btn-ghost btn-sm" href="#/nb/${nb.id}/quizzes">← Quizzes</a><span class="muted">${plural(quiz.attempts.length, 'attempt')}</span></div>
      <div class="card result-card ${scoreClass(ratio)}"><span class="eyebrow">${esc(quiz.title)}</span><div class="result-score">${a.score}<small>/${a.total}</small></div>
        ${quiz.kind === 'diagnostic' ? assessmentHtml(nb, quiz, a) : ''}
        <p class="lead">${quiz.kind === 'diagnostic' ? (assessing ? '' : nb.plan ? 'Your tutor uses these results in your sessions.' : 'Next, let’s turn this into a plan made for you.') : ratio === 1 ? 'Perfect score! 🎉' : ratio >= 0.8 ? 'Great work. You know this well.' : ratio >= 0.5 ? 'Solid start. Review the misses below.' : 'This is a good topic to revisit with your tutor.'}</p>
        <div class="form-actions center">${quiz.kind === 'diagnostic' && !nb.plan && !assessing ? '<button type="button" class="btn btn-primary btn-lg" data-action="plan-from-diagnostic">✦ Build my learning plan from these results</button>' : ''}${missed.length ? `<button type="button" class="btn ${quiz.kind === 'diagnostic' && !nb.plan ? 'btn-ghost' : 'btn-primary'} btn-lg" data-action="review-mistakes">Go over my mistakes with the tutor</button>` : ''}<button type="button" class="btn btn-ghost btn-lg" data-action="retake-quiz">↻ Retake quiz</button></div></div>
      <h2 class="section-title">Review</h2>
      <ol class="review-list">${quiz.questions.map((q, i) => { const ok = a.answers[i] === q.answer; return `<li class="review ${ok ? 'good' : 'bad'}"><div class="review-head"><span>${ok ? '✓' : '✗'}</span><div class="md">${md(q.question)}</div></div>
        ${ok ? '' : `<p><span class="label">Your answer</span> ${mdInline(q.choices[a.answers[i]] ?? '–')}</p>`}<p><span class="label">Correct answer</span> ${mdInline(q.choices[q.answer])}</p>${q.explanation ? `<div class="md muted-md">${md(q.explanation)}</div>` : ''}</li>`; }).join('')}</ol></div>`;
  }

  // ---------- Actions ----------
  function currentNb() { return route.nbId ? findNb(route.nbId) : null; }
  function startLesson(nb, lessonId) {
    const i = nb.plan?.lessons.findIndex((l) => l.id === lessonId) ?? -1; if (i < 0) return;
    const lesson = nb.plan.lessons[i];
    const existing = chats.find((c) => c.lessonId === lessonId && c.notebookId === nb.id);
    if (existing) return go(`#/nb/${nb.id}/chat/${existing.id}`);
    const chat = createChat({ notebookId: nb.id, title: `Lesson ${i + 1}: ${lesson.title}`, lessonId });
    go(`#/nb/${nb.id}/chat/${chat.id}`);
    sendMessage(chat, `Let's start **Lesson ${i + 1}: ${lesson.title}**.\n\n${lesson.objectives.length ? `By the end I want to be able to:\n${lesson.objectives.map((o) => `- ${o}`).join('\n')}\n\n` : ''}Teach it step by step for my level, check my understanding with a question along the way, and finish with a short recap.`);
  }
  function toggleLesson(nb, lessonId) {
    const l = nb.plan?.lessons.find((x) => x.id === lessonId); if (!l) return;
    l.done = !l.done; l.doneAt = l.done ? Date.now() : 0; nb.updatedAt = Date.now(); if (l.done) nb.lastStudiedAt = Date.now(); save();
    if (l.done) toast(nbProgress(nb).done === nbProgress(nb).total ? 'Plan complete! Amazing work. 🎉' : 'Lesson complete. Nice work! ✓');
    render(true);
  }
  function deleteChat(id) {
    const chat = chats.find((c) => c.id === id); if (!chat) return;
    showDialog({ title: 'Delete conversation?', label: `Delete “${chat.title}”? This cannot be undone.`, confirm: true, danger: true, saveText: 'Delete', onSave: () => {
      chats = chats.filter((c) => c.id !== id); save();
      if (route.chatId === id) go(chat.notebookId ? `#/nb/${chat.notebookId}/sessions` : '#/', { replace: true }); else render(true);
    } });
  }

  const actions = {
    attach: () => el.fileInput.click(),
    'remove-file': (t) => { pendingFiles.splice(Number(t.dataset.index), 1); renderAttachments(); },
    starter: (t) => { const box = $('#composer-home'); box.value = t.dataset.prompt; autoResize(box); box.focus(); },
    template: (t) => { draftTemplate = TEMPLATES[t.dataset.key]; go('#/notebooks/new'); },
    'rename-chat': (t) => { const chat = chats.find((c) => c.id === t.dataset.id); if (!chat) return; showDialog({ title: 'Rename conversation', label: 'Conversation name', value: chat.title, saveText: 'Save name', onSave: (v) => { chat.title = v; save(); render(true); } }); },
    'delete-chat': (t) => deleteChat(t.dataset.id),
    'clear-chats': () => {
      if (!generalChats().length) return toast('There are no chats to clear.');
      showDialog({ title: 'Clear chat history?', label: 'This deletes all general chats saved in this browser. Notebook sessions are kept.', confirm: true, danger: true, saveText: 'Clear chats', onSave: () => { chats = chats.filter((c) => c.notebookId); save(); go('#/'); toast('Chat history cleared.'); } });
    },
    'delete-notebook': () => {
      const nb = currentNb(); if (!nb) return;
      showDialog({ title: `Delete ${nb.name}?`, label: `This permanently deletes the notebook, its plan, ${plural(nb.quizzes.length, 'quiz')}, and ${plural(nbChats(nb).length, 'session')}.`, confirm: true, danger: true, saveText: 'Delete notebook', onSave: () => {
        notebooks = notebooks.filter((n) => n.id !== nb.id); chats = chats.filter((c) => c.notebookId !== nb.id); save(); go('#/', { replace: true }); toast('Notebook deleted.');
      } });
    },
    'wiz-next': (t) => { const form = t.closest('form'); const step = Number(form.dataset.step); if (validateStep(form, step)) wizardStep(form, step + 1); },
    'wiz-back': (t) => { const form = t.closest('form'); wizardStep(form, Number(form.dataset.step) - 1); },
    'retry-assessment': () => { const nb = currentNb(), quiz = nb?.quizzes.find((q) => q.id === route.quizId); if (quiz) assessDiagnostic(nb, quiz); },
    'plan-from-diagnostic': () => { const nb = currentNb(); if (!nb) return; go(`#/nb/${nb.id}/plan`); generatePlan(nb); },
    'generate-plan': () => { const nb = currentNb(); if (nb) generatePlan(nb); },
    'regenerate-plan': () => {
      const nb = currentNb(); if (!nb) return;
      showDialog({ title: 'Regenerate learning plan?', label: 'You’ll get a fresh plan based on your current goal, level, and quiz results. Lessons with the same title keep their completed status.', confirm: true, saveText: 'Regenerate', onSave: () => generatePlan(nb) });
    },
    'start-lesson': (t) => { const nb = currentNb(); if (nb) startLesson(nb, t.dataset.id); },
    'toggle-lesson': (t) => { const nb = currentNb(); if (nb) toggleLesson(nb, t.dataset.id); },
    'lesson-quiz': (t) => { const nb = currentNb(); if (nb) generateQuiz(nb, { lessonId: t.dataset.id, count: 5, difficulty: 'matched', kind: 'quiz' }); },
    'quick-quiz': (t) => { const nb = currentNb(); if (nb) generateQuiz(nb, { lessonId: '', count: Number(t.dataset.count) || 5, difficulty: 'matched', kind: 'quiz' }); },
    diagnostic: () => { const nb = currentNb(); if (nb) generateQuiz(nb, { lessonId: '', count: 8, difficulty: 'matched', kind: 'diagnostic' }); },
    'delete-quiz': (t) => {
      const nb = currentNb(); const quiz = nb?.quizzes.find((q) => q.id === t.dataset.id); if (!quiz) return;
      showDialog({ title: 'Delete quiz?', label: `Delete “${quiz.title}” and its results?`, confirm: true, danger: true, saveText: 'Delete', onSave: () => { nb.quizzes = nb.quizzes.filter((q) => q.id !== quiz.id); save(); render(true); } });
    },
    answer: (t) => {
      const nb = currentNb(), quiz = nb?.quizzes.find((q) => q.id === route.quizId); if (!quiz?.progress || quiz.progress.revealed) return;
      quiz.progress.answers.push(Number(t.dataset.index)); quiz.progress.revealed = true; nb.lastStudiedAt = Date.now(); save(); render(true);
    },
    'next-question': () => {
      const nb = currentNb(), quiz = nb?.quizzes.find((q) => q.id === route.quizId); if (!quiz?.progress) return;
      quiz.progress.revealed = false;
      if (quiz.progress.answers.length >= quiz.questions.length) {
        const answers = quiz.progress.answers;
        quiz.attempts.push({ at: Date.now(), answers, total: quiz.questions.length, score: answers.filter((a, i) => a === quiz.questions[i].answer).length });
        quiz.progress = null;
        save(); render(true);
        if (quiz.kind === 'diagnostic') assessDiagnostic(nb, quiz);
        return;
      }
      save(); render(true);
    },
    'retake-quiz': () => { const nb = currentNb(), quiz = nb?.quizzes.find((q) => q.id === route.quizId); if (!quiz) return; quiz.progress = { answers: [], revealed: false }; save(); render(true); },
    'review-mistakes': () => {
      const nb = currentNb(), quiz = nb?.quizzes.find((q) => q.id === route.quizId); if (!quiz?.attempts.length) return;
      const a = quiz.attempts[quiz.attempts.length - 1];
      const missed = quiz.questions.map((q, i) => ({ q, mine: a.answers[i] })).filter((x) => x.mine !== x.q.answer);
      const chat = createChat({ notebookId: nb.id, title: `Review: ${quiz.title}` });
      go(`#/nb/${nb.id}/chat/${chat.id}`);
      sendMessage(chat, `I just took the quiz **“${quiz.title}”** and scored ${a.score}/${a.total}. Help me understand what I got wrong:\n\n${missed.map((x, i) => `${i + 1}. ${x.q.question}\n   - I answered: ${x.q.choices[x.mine] ?? '–'}\n   - Correct answer: ${x.q.choices[x.q.answer]}`).join('\n')}\n\nExplain the idea behind each one, then give me a similar practice question to check I've got it.`);
    }
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (t && actions[t.dataset.action]) { e.preventDefault(); actions[t.dataset.action](t, e); }
  });

  // Keyboard shortcuts for quizzes (1-6 pick an answer, Enter goes to the next question).
  document.addEventListener('keydown', (e) => {
    if (route.view !== 'quiz' || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-6]$/.test(e.key)) $(`.choice[data-index="${Number(e.key) - 1}"]:not([disabled])`)?.click();
    else if (e.key === 'Enter' && $('[data-action="next-question"]')) { e.preventDefault(); $('[data-action="next-question"]').click(); }
  });

  // Composer behaviour (delegated so it works for whatever view is on screen).
  document.addEventListener('input', (e) => { if (e.target.matches('.composer textarea')) autoResize(e.target); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('.composer textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.dataset.composer) {
      e.preventDefault();
      const box = form.querySelector('textarea'), text = box.value.trim();
      if (!text && !pendingFiles.length) return;
      if (busy) { toast('Please wait for the current answer to finish.'); return; }
      const files = pendingFiles.map((f) => ({ ...f })); pendingFiles = []; box.value = ''; autoResize(box); renderAttachments();
      const nb = currentNb();
      let chat;
      if (form.dataset.composer === 'chat') chat = chats.find((c) => c.id === route.chatId);
      else { chat = createChat({ notebookId: nb && form.dataset.composer === 'nb-new' ? nb.id : '' }); go(chat.notebookId ? `#/nb/${nb.id}/chat/${chat.id}` : `#/chat/${chat.id}`); }
      if (chat) sendMessage(chat, text, files);
      return;
    }
    if (form.dataset.form === 'notebook') {
      e.preventDefault();
      const f = new FormData(form);
      const fields = { name: String(f.get('name') || '').trim(), icon: f.get('icon'), color: f.get('color'), grade: String(f.get('grade') || ''), struggles: String(f.get('struggles') || '').trim(), goal: String(f.get('goal') || '').trim(), pace: f.get('pace') || 'steady', deadline: f.get('deadline') || '' };
      const existing = currentNb();
      if (existing) {
        if (!fields.name) return form.querySelector('#nbName').focus();
        Object.assign(existing, fields, { updatedAt: Date.now() }); save(); toast('Notebook saved.'); go(`#/nb/${existing.id}`); return;
      }
      if (!validateStep(form, 1)) return wizardStep(form, 1);
      if (!validateStep(form, 2)) return wizardStep(form, 2);
      const nb = newNotebook(fields); notebooks.unshift(nb); save();
      const choice = e.submitter?.value || 'diagnostic';
      if (choice === 'diagnostic') { history.replaceState(null, '', `#/nb/${nb.id}`); generateQuiz(nb, { lessonId: '', count: 8, difficulty: 'matched', kind: 'diagnostic' }); }
      else if (choice === 'plan') { go(`#/nb/${nb.id}/plan`); generatePlan(nb); }
      else go(`#/nb/${nb.id}`);
      return;
    }
    if (form.dataset.form === 'quiz') {
      e.preventDefault();
      const nb = currentNb(); if (!nb) return;
      const f = new FormData(form), scope = String(f.get('scope') || '');
      generateQuiz(nb, { kind: scope === 'diagnostic' ? 'diagnostic' : 'quiz', lessonId: scope === 'diagnostic' ? '' : scope, count: Number(f.get('count')) || 8, difficulty: String(f.get('difficulty') || 'matched') });
    }
  });

  document.addEventListener('keydown', (e) => {
    const form = e.target.closest?.('form.wizard');
    if (form && e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); form.querySelector(`.wizard-step[data-step="${form.dataset.step}"] [data-action="wiz-next"]`)?.click(); }
  });

  // Paste images straight into a composer.
  document.addEventListener('paste', (e) => {
    if (!e.target.matches('.composer textarea')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => ALLOWED_TYPES.has(f.type));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // ---------- Chrome ----------
  function applyFont(theme) {
    const selected = FONTS[theme] ? theme : 'rounded';
    document.documentElement.style.setProperty('--chat-font', FONTS[selected]); el.font.value = selected;
    try { localStorage.setItem(KEYS.font, selected); } catch {}
  }
  el.font.addEventListener('change', () => applyFont(el.font.value));
  $('#openSidebar').addEventListener('click', openSidebar);
  $('#closeSidebar').addEventListener('click', closeSidebar);
  el.scrim.addEventListener('click', closeSidebar);

  // ---------- Boot ----------
  migrate();
  if (!Array.isArray(chats)) chats = [];
  if (!Array.isArray(notebooks)) notebooks = [];
  for (const nb of notebooks) { nb.quizzes ||= []; }
  // The previous version created these notebooks automatically when a subject card was clicked.
  // Drop them if they were never used (no goal, plan, quizzes, or sessions), since notebooks now start empty.
  const AUTO_CREATED = ['Math & Numbers', 'Science & Nature', 'Writing & Language', 'History & Society'];
  const unused = (nb) => AUTO_CREATED.includes(nb.name) && !nb.goal && !nb.struggles && !nb.plan && !nb.quizzes.length && !chats.some((c) => c.notebookId === nb.id);
  if (notebooks.some(unused)) { notebooks = notebooks.filter((nb) => !unused(nb)); save(); }
  applyFont(load(KEYS.font, null) || localStorage.getItem(KEYS.font) || 'rounded');
  render(true);
})();
