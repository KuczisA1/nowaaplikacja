/* =========================================================
   ChemDisk – script.js (proxy do Netlify Functions, ENV key)
   ========================================================= */

const API = {
  MODE: 'proxy',
  PROXY_URL: '/.netlify/functions/chat', // <-- bezpośrednio w funkcję
  CHAT_MODEL: 'gemini-2.5-flash',
  TEMPERATURE: 0.2
};

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
    maturaTemplate: $('#matura-system-prompt'),
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

  const state = {
    matura: localStorage.getItem('chem.matura') === '1',
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
    setMatura(state.matura);

    on(els.suggestions, 'click', (e) => {
      const item = e.target.closest('.suggestions-item'); if (!item) return;
      const text = $('.text', item)?.textContent?.trim() || '';
      els.promptInput.value = text;
      els.promptInput.focus();
    });

    on(els.modeMaturaBtn,'click',()=>setMatura(!state.matura));
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

  // ---------- Matura toggle ----------
  function setMatura(onOff){
    state.matura = onOff; localStorage.setItem('chem.matura', onOff?'1':'0');
    els.modeMaturaBtn.classList.toggle('selected', onOff);
    els.modeMaturaBtn.setAttribute('aria-pressed', onOff?'true':'false');
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
    state.attachment = file||null;
    if(file && file.type?.startsWith('image/')){ const url=URL.createObjectURL(file); els.filePreview.src=url; els.filePreview.style.display='inline-block'; }
    else { els.filePreview.removeAttribute('src'); els.filePreview.style.display='none'; }
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

    state.busy=true; setBusy(true);
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
      state.busy=false; setBusy(false); clearAttachment();
    }
  }

  function stopGeneration(){ if(state.aborter){ try{state.aborter.abort();}catch{} state.aborter=null; } setBusy(false); state.busy=false; }
  function setBusy(b){
    els.stopBtn.disabled=!b;
    [els.sendBtn, els.modeMaturaBtn].forEach(x=>x.disabled=b);
    els.promptInput.disabled = b;
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
    const tpl = document.querySelector('#matura-system-prompt')?.content?.textContent || '';
    return tpl.trim();
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
