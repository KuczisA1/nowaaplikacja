/* =========================================================
   ChemDisk – script.js (proxy do Netlify Functions, ENV key)
   ========================================================= */

const API = {
  MODE: 'proxy',
  PROXY_URL: '/.netlify/functions/chat', // <-- bezpośrednio w funkcję
  CHAT_MODEL: 'gemini-2.5-flash',
  TEMPERATURE: 0.2
};

const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  const els = {
    modeMaturaBtn: $('#matura-mode-btn'),
    chats: $('.chats-container'),
    promptForm: $('.prompt-form'),
    promptInput: $('.prompt-input'),
    sendBtn: $('#send-prompt-btn'),
    stopBtn: $('#stop-response-btn'),
    themeBtn: $('#theme-toggle-btn'),
    deleteChatsBtn: $('#delete-chats-btn'),
    fileInput: $('#file-input'),
    addFileBtn: $('#add-file-btn'),
    cancelFileBtn: $('#cancel-file-btn'),
    filePreview: $('.file-preview'),
    suggestions: $('.suggestions'),
  };

  function prefersDark(){
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return false; }
  }
  function loadInitialTheme(){
    try {
      const saved = localStorage.getItem('chem.theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return prefersDark() ? 'dark' : 'light';
  }

  function loadStoredMaturaPreference(){
    try {
      return localStorage.getItem('chem.matura') === '1';
    } catch {
      return false;
    }
  }

  const state = {
    matura: false,
    maturaAvailable: false,
    maturaStoredPreference: loadStoredMaturaPreference(),
    maturaPrompt: '',
    busy: false,
    aborter: null,
    messages: [],
    theme: loadInitialTheme(),
    attachment: null,
  };

  // ---------- Init ----------
  function applyTheme(theme, persist = true){
    const next = theme === 'dark' ? 'dark' : 'light';
    state.theme = next;
    if (persist) {
      try { localStorage.setItem('chem.theme', next); } catch {}
    }
    const dark = next === 'dark';
    document.body.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    updateThemeButton();
  }

  function updateThemeButton(){
    if (!els.themeBtn) return;
    const dark = state.theme === 'dark';
    const label = dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw';
    els.themeBtn.textContent = dark ? 'dark_mode' : 'light_mode';
    els.themeBtn.setAttribute('aria-label', label);
    els.themeBtn.title = label;
  }

  function bootstrap(){
    applyTheme(state.theme, false);
    updateMaturaButton();
    initMaturaPrompt();

    on(els.suggestions, 'click', (e) => {
      const item = e.target.closest('.suggestions-item'); if (!item) return;
      const text = $('.text', item)?.textContent?.trim() || '';
      els.promptInput.value = text;
      els.promptInput.focus();
    });

    on(els.modeMaturaBtn,'click',()=>{ if(!state.maturaAvailable) return; setMatura(!state.matura); });
    on(els.promptForm,'submit',handlePromptSubmit);
    on(els.sendBtn,'click',(e)=>{ e.preventDefault(); els.promptForm.requestSubmit(); });
    on(els.stopBtn,'click',stopGeneration);
    on(els.promptInput,'keydown',(e)=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); els.promptForm.requestSubmit(); } });

    on(els.addFileBtn,'click',()=>els.fileInput.click());
    on(els.fileInput,'change',handleFileSelect);
    on(els.cancelFileBtn,'click',clearAttachment);
    enableDragAndDrop();

    on(els.themeBtn,'click',toggleTheme);
    on(els.deleteChatsBtn,'click',clearChats);
    on(els.promptInput,'focus',()=>setTimeout(()=>els.promptInput.scrollIntoView({block:'center',behavior:'smooth'}),150));

    els.promptInput?.focus();
  }

  // ---------- Matura prompt & toggle ----------
  async function initMaturaPrompt(){
    const raw = getPromptSourceFromUrl();
    if (!raw) {
      disableMaturaMode();
      return;
    }

    const sanitized = sanitizePromptPath(raw);
    if (!sanitized) {
      disableMaturaMode();
      return;
    }

    try {
      const promptText = await fetchPromptText(sanitized);
      enableMaturaMode(promptText);
    } catch (err) {
      console.error('Nie udało się wczytać promptu trybu maturzysty', err);
      disableMaturaMode();
    }
  }

  function getPromptSourceFromUrl(){
    try {
      const url = new URL(window.location.href);
      const value = url.searchParams.get('prompt');
      return value ? value.trim() : '';
    } catch {
      return '';
    }
  }

  function sanitizePromptPath(raw){
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) return '';
    if (trimmed.includes('..') || trimmed.includes('\\')) return '';
    return trimmed;
  }

  async function fetchPromptText(path){
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawText = await response.text();
    let promptText = rawText;
    try {
      const parsed = JSON.parse(rawText);
      promptText = extractPromptText(parsed) || '';
    } catch {
      promptText = rawText;
    }

    if (!promptText.trim()) {
      throw new Error('Pusty prompt');
    }

    return promptText.trim();
  }

  function extractPromptText(data){
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
      return data.filter((item) => typeof item === 'string').join('\n');
    }
    if (data && typeof data === 'object') {
      const candidates = ['prompt', 'system', 'text', 'value', 'content'];
      for (const key of candidates) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) return value;
        if (Array.isArray(value)) {
          const joined = value.filter((item) => typeof item === 'string').join('\n');
          if (joined.trim()) return joined;
        }
      }
    }
    return '';
  }

  function enableMaturaMode(promptText){
    state.maturaPrompt = promptText;
    state.maturaAvailable = true;
    if (els.modeMaturaBtn) {
      els.modeMaturaBtn.hidden = false;
    }
    setMatura(state.maturaStoredPreference, { persist: false });
  }

  function disableMaturaMode(){
    state.maturaAvailable = false;
    state.maturaPrompt = '';
    setMatura(false, { persist: false });
    if (els.modeMaturaBtn) {
      els.modeMaturaBtn.hidden = true;
    }
  }

  function setMatura(onOff, { persist = true } = {}){
    const enabled = state.maturaAvailable && !!onOff;
    state.matura = enabled;
    if (persist && state.maturaAvailable) {
      state.maturaStoredPreference = enabled;
      try { localStorage.setItem('chem.matura', enabled ? '1' : '0'); } catch {}
    }
    updateMaturaButton();
  }

  function updateMaturaButton(){
    const btn = els.modeMaturaBtn;
    if (!btn) return;
    btn.classList.toggle('selected', state.matura);
    btn.setAttribute('aria-pressed', state.matura ? 'true' : 'false');
    btn.disabled = state.busy || !state.maturaAvailable;
  }

  // ---------- Messages UI ----------
  function messageEl(role, html){ const d=document.createElement('div'); d.className=`message ${role}`; d.innerHTML=html; return d; }
  function addUserMessage(text){ const el=messageEl('user',`<strong>Ty:</strong><div class="md">${escapeHtml(text)}</div>`); els.chats.appendChild(el); scrollToBottom(); return el; }
  function addAssistantMessage(initial = '') { const el = messageEl('assistant', `<strong>ChemDisk:</strong><div class="md">${initial || '<em>Generowanie...</em>'}</div>`); els.chats.appendChild(el); scrollToBottom(); return el; }
  function updateAssistantMessage(el, html) { el.innerHTML = `<strong>ChemDisk:</strong><div class="md">${html}</div>`; scrollToBottom(); }
  function scrollToBottom(){ requestAnimationFrame(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})); }
  function clearChats(){ if(!confirm('Wyczyścić historię czatu?')) return; els.chats.innerHTML=''; state.messages=[]; localStorage.removeItem('chem.messages'); }

  // ---------- Pliki ----------
  function handleFileSelect(){ const f=els.fileInput.files?.[0]||null; setAttachment(f); }
  function setAttachment(file){
    state.attachment = null;

    if(file && file.type?.startsWith('image/')){
      if(file.size > IMAGE_SIZE_LIMIT){
        alert('Zdjęcie może mieć maksymalnie 5 MB.');
        if(els.fileInput) els.fileInput.value='';
        els.filePreview.removeAttribute('src');
        els.filePreview.style.display='none';
        return;
      }
      state.attachment = file;
      const url=URL.createObjectURL(file);
      els.filePreview.src=url;
      els.filePreview.style.display='inline-block';
      return;
    }

    if(file){
      state.attachment = file;
    }
    els.filePreview.removeAttribute('src');
    els.filePreview.style.display='none';
  }
  function clearAttachment(){ state.attachment=null; if(els.fileInput) els.fileInput.value=''; els.filePreview.removeAttribute('src'); els.filePreview.style.display='none'; }

  function enableDragAndDrop(){
    const zone = els.promptForm;
    const over = (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; zone.classList.add('drag-over'); };
    const leave = ()=> zone.classList.remove('drag-over');
    ['dragenter','dragover'].forEach(ev=>on(zone,ev,over));
    ['dragleave','dragend','drop'].forEach(ev=>on(zone,ev,leave));
    on(zone,'drop',async(e)=>{
      e.preventDefault();
      const dt = e.dataTransfer; if(!dt) return;
      if(dt.files && dt.files.length){ setAttachment(dt.files[0]); return; }
      const txt = dt.getData('text/plain'); if(txt){ els.promptInput.value = (els.promptInput.value?els.promptInput.value+'\n':'') + txt; els.promptInput.focus(); }
    });
  }

  // ---------- Theme ----------
  function toggleTheme(){ applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }

  // ---------- Submit ----------
  async function handlePromptSubmit(e){
    e.preventDefault(); if(state.busy) return;
    const text = (els.promptInput.value||'').trim(); if(!text && !state.attachment) return;

    addUserMessage(text || (state.attachment?'[Załącznik]':''));
    els.promptInput.value='';
    state.messages.push({ role:'user', content:text });

    setBusy(true);
    const assistantEl = addAssistantMessage();

    try{
      const system = state.matura ? getMaturaSystemPrompt() : null;
      const resText = await chatGenerate({ messages: state.messages, system, attachment: state.attachment });
      updateAssistantMessage(assistantEl, renderMarkdown(resText || ''));
      state.messages.push({ role:'assistant', content: resText });
    }catch(err){
      console.error(err);
      updateAssistantMessage(assistantEl, `<span style="color:#b91c1c">Błąd: ${escapeHtml(err.message||'nieznany')}</span>`);
    }finally{
      setBusy(false); clearAttachment();
    }
  }

  function stopGeneration(){
    if(state.aborter){
      try { state.aborter.abort(); }
      catch {}
      state.aborter = null;
    }
    setBusy(false);
  }
  function setBusy(b){
    state.busy = b;
    if (els.stopBtn) els.stopBtn.disabled = !b;
    if (els.sendBtn) els.sendBtn.disabled = b;
    els.promptInput.disabled = b;
    updateMaturaButton();
  }

  // ---------- Backend: proxy ----------
  async function chatGenerate({ messages, system=null, attachment=null }){
    return chatViaProxy({ messages, system, attachment });
  }

  async function chatViaProxy({ messages, system, attachment }){
    // Zamieniamy ewentualny obrazek na Base64 i wysyłamy JSON-em
    let attachmentInline = null;
    if (attachment && attachment.type?.startsWith('image/')) {
      attachmentInline = { mimeType: attachment.type, data: await fileToBase64(attachment) };
    }

    const payload = {
      messages,
      system,
      attachmentInline,
      options: { model: API.CHAT_MODEL, temperature: API.TEMPERATURE }
    };

    const ac=new AbortController(); setAborter(ac);
    const res=await fetch(API.PROXY_URL,{
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    setAborter(null);

    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    return data?.text || '';
  }

  // ---------- Matura system prompt ----------
  function getMaturaSystemPrompt(){
    return state.maturaPrompt;
  }

  // ---------- Markdown (lekki) ----------
  function renderMarkdown(src) {
    const text = String(src || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    let out = '';
    let inPre = false, inUl = false, inOl = false;
    const closeLists = () => { if (inUl) { out += '</ul>'; inUl = false; } if (inOl) { out += '</ol>'; inOl = false; } };

    for (let raw of lines) {
      const line = raw;
      if (/^```/.test(line)) { if (inPre) { out += '</code></pre>'; inPre = false; } else { closeLists(); out += '<pre class="code"><code>'; inPre = true; } continue; }
      if (inPre) { out += escapeHtml(line) + '\n'; continue; }
      if (/^#{1,6}\s+/.test(line)) { closeLists(); const level=(line.match(/^#{1,6}/)||['#'])[0].length; const content=line.replace(/^#{1,6}\s+/, ''); out += `<h${level}>${mdInline(escapeHtml(content))}</h${level}>`; continue; }
      if (/^\s*\d+[.)]\s+/.test(line)) { if (!inOl) { closeLists(); out += '<ol>'; inOl = true; } const content = line.replace(/^\s*\d+[.)]\s+/, ''); out += `<li>${mdInline(escapeHtml(content))}</li>`; continue; }
      if (/^\s*[-*•]\s+/.test(line)) { if (!inUl) { closeLists(); out += '<ul>'; inUl = true; } const content = line.replace(/^\s*[-*•]\s+/, ''); out += `<li>${mdInline(escapeHtml(content))}</li>`; continue; }
      if (/^\s*$/.test(line)) { closeLists(); continue; }
      closeLists(); out += `<p>${mdInline(escapeHtml(line))}</p>`;
    }
    closeLists();
    return out;
  }
  function mdInline(s) {
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\b(https?:\/\/[^\s<]+[^\s<\.)])/gi, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  // ---------- Utils ----------
  function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
  function setAborter(ac){ state.aborter = ac; }
  function fileToBase64(file){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>{ const dataUrl=String(r.result||''); const base64=dataUrl.split(',')[1]||''; res(base64); };
      r.onerror=rej; r.readAsDataURL(file);
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
