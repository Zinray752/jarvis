// app.js: wires the screens together. Logic lives in the other modules.
import { createStore } from './store.js';
import { createMemory, parseMemoryCommand, MEMORY_KINDS } from './memory.js';
import { AGENTS, getAgent, routeMessage, buildSystemPrompt, pickTeam, buildTeamPrompt } from './agents.js';
import { PROVIDERS, chat, listModels, migrateBrain } from './llm.js';
import { wikiResearch, sourcesPrompt } from './web.js';
import { findSecrets, redactSecrets } from './security.js';
import * as voice from './voice.js';

export const VERSION = '2.0.0';

const store = createStore();
const memory = createMemory(store);
const $ = (s) => document.querySelector(s);

const DEFAULT_SETTINGS = {
  userName: '',
  agent: 'auto',
  webResearch: true,
  teamMode: true,
  brain: { provider: 'gemini', model: '', customUrl: '', apiKeys: {} },
  voice: { lang: 'en-GB', voiceURI: '', rate: 1, pitch: 1.05, volume: 1, autoSpeak: false, handsFree: false },
};
function loadSettings() {
  const s = store.get('settings', {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    brain: { ...DEFAULT_SETTINGS.brain, ...migrateBrain(s.brain || {}), apiKeys: { ...((s.brain && s.brain.apiKeys) || {}) } },
    voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice || {}) },
  };
}
let settings = loadSettings();
const saveSettings = () => store.set('settings', settings);
let busy = false;
let listener = null;

// ---------- helpers ----------
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Small, safe markdown: escape everything first, then add formatting.
export function renderMarkdown(md = '') {
  const blocks = [];
  let text = esc(md).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const lines = text.split('\n');
  let html = '';
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) html += `<p>${para.join('<br>')}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const h = line.match(/^\s*#{1,6}\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (list !== type) {
        closeList();
        html += `<${type}>`;
        list = type;
      }
      html += `<li>${(ul || ol)[1]}</li>`;
    } else if (h) {
      flushPara();
      closeList();
      html += `<p><strong>${h[1]}</strong></p>`;
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- status ----------
function needsKey() {
  const p = PROVIDERS[settings.brain.provider];
  return !!(p && p.needsKey && !settings.brain.apiKeys[settings.brain.provider]);
}
function updateStatus() {
  const p = PROVIDERS[settings.brain.provider];
  const shortName = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', custom: 'Custom brain' }[settings.brain.provider];
  const online = navigator.onLine === false ? 'Offline' : 'Online';
  const keyMissing = p.needsKey && !settings.brain.apiKeys[settings.brain.provider];
  $('#status').textContent = `${online} · ${shortName}${keyMissing ? ' (key needed)' : ''}`;
  $('#speakToggle').setAttribute('aria-pressed', String(!!settings.voice.autoSpeak));
}

// ---------- navigation ----------
const VIEWS = ['home', 'agents', 'memory', 'projects', 'more', 'research', 'automations', 'settings'];
function showView() {
  const name = (location.hash || '#home').slice(1);
  const view = VIEWS.includes(name) ? name : 'home';
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  const tab = ['research', 'automations', 'settings'].includes(view) ? 'more' : view;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  if (view === 'agents') renderAgents();
  if (view === 'memory') renderMemory();
  if (view === 'projects') renderProjects();
  if (view === 'settings') renderSettings();
  if (view === 'home') {
    renderProjectPill();
    scrollToBottom();
  }
  window.scrollTo({ top: view === 'home' ? document.body.scrollHeight : 0 });
}

// ---------- home / chat ----------
function renderAgentStrip() {
  const strip = $('#agentStrip');
  const opts = [{ id: 'auto', name: 'AUTO', colour: '#38d6ff', role: 'JARVIS decides' }, ...AGENTS];
  strip.innerHTML = opts
    .map((a) => `<button class="chip" role="radio" data-agent="${a.id}" aria-checked="${settings.agent === a.id}" style="--agent:${a.colour}" title="${esc(a.role)}">${a.name}</button>`)
    .join('');
}

function renderProjectPill() {
  const p = memory.project(memory.activeProjectId());
  const pill = $('#projectPill');
  pill.hidden = !p;
  if (p) pill.textContent = `Current project: ${p.name}`;
}

function messageHtml(m) {
  if (m.role === 'user') return `<div class="msg user" data-id="${m.id}">${esc(m.content).replace(/\n/g, '<br>')}</div>`;
  if (m.role === 'system') return `<div class="msg system" data-id="${m.id}">${renderMarkdown(m.content)}</div>`;
  const a = getAgent(m.agentId);
  return `<div class="msg assistant${m.error ? ' error' : ''}" data-id="${m.id}">
    <div class="who" style="color:${a.colour}">${a.name}${m.reason ? `<span class="why">· ${esc(m.reason)}</span>` : ''}</div>
    <div class="body">${renderMarkdown(m.content)}</div>
    ${m.sources && m.sources.length ? `<div class="sources small"><b>Sources</b><ol>${m.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a> <span class="muted">(Wikipedia)</span></li>`).join('')}</ol></div>` : ''}
    ${m.error ? '' : `<div class="msg-actions"><button data-act="speak">Read aloud</button><button data-act="copy">Copy</button><button data-act="remember">Remember this</button></div>`}
  </div>`;
}

function renderMessages() {
  const list = memory.conversation();
  const box = $('#messages');
  if (!list.length) {
    const name = settings.userName ? `, ${esc(settings.userName)}` : '';
    box.innerHTML = `<div class="welcome"><div class="big-orb"></div>
      <h1>Good ${partOfDay()}${name}.</h1>
      <p class="muted">JARVIS is online. Type or tap the mic. Ask anything, or try one of these:</p>
      <div class="suggest">
        <button data-suggest="Plan a realistic study timetable for my exams this week">Plan my study week</button>
        <button data-suggest="Explain black holes and event horizons simply">Explain event horizons</button>
        <button data-suggest="Give me 5 ideas to get sponsors for a youth cycling project">Sponsor ideas</button>
        <button data-suggest="How do I put a simple website on GitHub for free?">Free website on GitHub</button>
        <button data-suggest="Remember that I prefer short, direct answers">Teach it a preference</button>
      </div>
      ${needsKey() ? `<div class="card stack setup" id="setupCard"><h2>Connect JARVIS's brain</h2>
        <p class="muted small">JARVIS needs a free AI key before it can answer. It takes about two minutes and costs nothing:</p>
        <ol class="small"><li>Open Google AI Studio and sign in with your Google account.</li><li>Tap <b>Create API key</b> and copy it.</li><li>Paste it in Settings → Brain and tap <b>Test connection</b>.</li></ol>
        <div class="row"><a class="btn" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get free key</a><a class="btn primary" href="#settings">Open Settings</a></div>
        <p class="muted small">Memory, projects and settings already work without it.</p></div>` : ''}
      ${settings.userName ? '' : '<p class="small muted">Tip: set your name in More → Settings.</p>'}
    </div>`;
    return;
  }
  box.innerHTML = list.map(messageHtml).join('');
  scrollToBottom();
}
function partOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}
function scrollToBottom() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
}

function setWorking(agent) {
  busy = !!agent;
  $('#working').hidden = !agent;
  $('#orb').classList.toggle('busy', !!agent);
  $('#sendBtn').disabled = !!agent;
  if (agent) {
    $('#workingText').textContent = `${agent.name} is working…`;
    $('#working').style.setProperty('--agentc', agent.colour);
  }
}

function addLocal(role, content, extra = {}) {
  const m = memory.appendMessage({ role, content, ...extra });
  renderMessages();
  return m;
}

async function handleSend(rawText) {
  const original = (rawText || '').trim();
  if (!original || busy) return;
  voice.stopSpeaking();

  // 1. Secrets never leave the phone and are never stored.
  const secrets = findSecrets(original);
  const text = secrets.length ? redactSecrets(original) : original;
  addLocal('user', text);
  if (secrets.length) {
    addLocal('system', `I hid what looked like a **${secrets.join(' and ')}** before saving or sending your message. If it was real, change it now, because it has been typed into a chat.`);
  }

  // 2. Memory commands are handled on the phone, no AI needed.
  const cmd = parseMemoryCommand(text);
  if (cmd) {
    if (secrets.length && cmd.action === 'remember') {
      addLocal('assistant', "I didn't save that. Passwords and keys never go into memory: keep them in a password manager.", { agentId: 'jarvis', reason: 'memory', error: true });
      return;
    }
    return handleMemoryCommand(cmd);
  }

  // 3. Route to an agent (or a team) and ask the brain.
  const route = routeMessage(text, settings.agent);
  const team = settings.teamMode ? pickTeam(text, settings.agent, route.scores) : [];
  const lead = getAgent(team.length ? 'jarvis' : route.agentId);
  setWorking(lead);
  const projectId = memory.activeProjectId();
  const ctx = {
    userName: settings.userName,
    memories: memory.relevant(text, { projectId }),
    projectSummary: projectId ? memory.projectSummary(projectId) : '',
    nowText: new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
  const history = memory.recentContext(12);
  try {
    // SIMONE gets live sources whenever she is involved.
    let sources = [];
    if (settings.webResearch && (route.agentId === 'simone' || team.includes('simone'))) {
      $('#workingText').textContent = 'SIMONE is searching Wikipedia…';
      try { sources = await wikiResearch(text); } catch { sources = []; }
    }
    const ask = (agent, extraSystem = '') => {
      const system = [buildSystemPrompt(agent, ctx), extraSystem].filter(Boolean).join('\n\n');
      return chat(settings.brain, [{ role: 'system', content: system }, ...history]);
    };
    let reply;
    let extra;
    if (team.length) {
      const contributions = [];
      for (const id of team) {
        const a = getAgent(id);
        $('#workingText').textContent = `${a.name} is working on their part…`;
        $('#working').style.setProperty('--agentc', a.colour);
        contributions.push({ name: a.name, role: a.role, text: await ask(a, id === 'simone' ? sourcesPrompt(sources) : '') });
      }
      $('#workingText').textContent = 'JARVIS is combining the answers…';
      $('#working').style.setProperty('--agentc', lead.colour);
      reply = await ask(lead, buildTeamPrompt(contributions));
      extra = { agentId: 'jarvis', reason: `team: ${team.map((id) => getAgent(id).name).join(' + ')}`, team, sources };
    } else {
      reply = await ask(lead, lead.id === 'simone' ? sourcesPrompt(sources) : '');
      extra = { agentId: lead.id, reason: route.reason + (sources.length ? ' · live sources' : ''), sources };
    }
    addLocal('assistant', reply, extra);
    if (settings.voice.autoSpeak) speakReply(reply);
  } catch (e) {
    addLocal('assistant', `I couldn't get an answer: ${e.message}`, { agentId: 'jarvis', error: true });
  } finally {
    setWorking(null);
  }
}

function handleMemoryCommand(cmd) {
  const projectId = null;
  if (cmd.action === 'remember') {
    try {
      const kind = /^(always|never|don't|do not|please always|from now on)\b/i.test(cmd.text) ? 'instruction' : /^i (prefer|like|love|hate|dislike|want you)/i.test(cmd.text) ? 'preference' : /^(my goal|i want to|i plan to|i'm aiming)/i.test(cmd.text) ? 'goal' : 'fact';
      const item = memory.add({ text: cmd.text, kind, projectId, source: 'chat' });
      addLocal('assistant', `Noted. I'll remember that as a **${item.kind}**: "${item.text}". You can edit or delete it under Memory.`, { agentId: 'jarvis', reason: 'memory' });
    } catch (e) {
      addLocal('assistant', e.message, { agentId: 'jarvis', reason: 'memory', error: true });
    }
  } else if (cmd.action === 'forget') {
    const hits = memory.search(cmd.query, { limit: 3 });
    if (!hits.length) addLocal('assistant', `I couldn't find anything in memory matching "${cmd.query}".`, { agentId: 'jarvis', reason: 'memory' });
    else {
      memory.remove(hits[0].id);
      addLocal('assistant', `Forgotten: "${hits[0].text}".${hits.length > 1 ? ' Other close matches are still in Memory if you want to remove them too.' : ''}`, { agentId: 'jarvis', reason: 'memory' });
    }
  } else if (cmd.action === 'list') {
    const all = memory.list();
    addLocal('assistant', all.length ? `Here's what I remember:\n${all.map((m) => `- (${m.kind}) ${m.text}`).join('\n')}` : "Nothing yet. Say \"remember that ...\" and I'll keep it.", { agentId: 'jarvis', reason: 'memory' });
  }
}

function speakReply(text) {
  voice.speak(text, settings.voice, {
    onEnd: () => {
      if (settings.voice.handsFree && listener && !busy) startListening();
    },
  });
}

// ---------- voice input ----------
function setupMic() {
  const support = voice.voiceSupport();
  const mic = $('#micBtn');
  if (!support.stt) {
    mic.addEventListener('click', () => toast('Voice input is not available in this browser. Use Chrome on Android.'));
    return;
  }
  listener = voice.createListener({
    lang: settings.voice.lang,
    onInterim: (t) => ($('#input').value = t),
    onState: (s) => {
      mic.classList.toggle('listening', s === 'listening');
      $('#orb').classList.toggle('listening', s === 'listening');
    },
    onText: (t) => {
      $('#input').value = '';
      handleSend(t);
    },
    onError: (msg) => toast(msg),
  });
  mic.addEventListener('click', () => {
    if (mic.classList.contains('listening')) listener.stop();
    else startListening();
  });
}
function startListening() {
  voice.stopSpeaking();
  listener && listener.start();
}

// ---------- agents view ----------
function renderAgents() {
  $('#agentCards').innerHTML = AGENTS.map(
    (a) => `<div class="card agent-card" style="--agent:${a.colour}">
      <div class="tag">${a.name}</div>
      <h2>${esc(a.role)}</h2>
      <p class="muted">${esc(a.summary)}</p>
      <ul>${a.abilities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="small muted">Status: active persona · ${a.id === 'jarvis' ? 'routes every message' : 'picked automatically by keywords or by you'}</p>
      <button class="btn sm" data-chat="${a.id}">Chat with ${a.name}</button>
    </div>`
  ).join('');
}

// ---------- memory view ----------
function renderMemory() {
  const q = $('#memorySearch').value;
  const items = q ? memory.search(q, { limit: 100 }) : memory.list().slice().reverse();
  $('#memoryList').innerHTML = items.length
    ? items
        .map(
          (m) => `<div class="item" data-mem="${m.id}">
      <div class="grow"><div class="kind">${m.kind}${m.projectId ? ' · project' : ''}</div><div class="txt">${esc(m.text)}</div><div class="small muted">${fmtTime(m.updatedAt)}</div></div>
      <button class="btn sm" data-act="edit">Edit</button><button class="btn sm danger" data-act="del">Delete</button></div>`
        )
        .join('')
    : `<div class="empty">${q ? 'No memories match that search.' : 'No memories yet.'}</div>`;
  const conv = memory.conversation();
  $('#convInfo').textContent = `${conv.length} message${conv.length === 1 ? '' : 's'} in the current conversation. JARVIS sends the last 12 with each question.`;
}

// ---------- projects view ----------
let openProject = null;
function renderProjects() {
  const list = memory.projects();
  const active = memory.activeProjectId();
  $('#projectList').innerHTML = list.length
    ? list
        .map((p) => {
          const open = p.tasks.filter((t) => !t.done).length;
          return `<div class="item${p.id === active ? ' active' : ''}" data-proj="${p.id}">
        <div class="grow"><div class="kind">${p.id === active ? 'current project' : p.status}</div><div class="txt"><strong>${esc(p.name)}</strong></div><div class="small muted">${open} open task${open === 1 ? '' : 's'} · ${p.notes.length} note${p.notes.length === 1 ? '' : 's'}</div></div>
        <button class="btn sm" data-act="open">Open</button></div>`;
        })
        .join('')
    : '<div class="empty">No projects yet.</div>';
  renderProjectDetail();
}
function renderProjectDetail() {
  const box = $('#projectDetail');
  const p = openProject && memory.project(openProject);
  if (!p) {
    box.innerHTML = '';
    return;
  }
  const active = memory.activeProjectId() === p.id;
  box.innerHTML = `<div class="card stack" data-proj="${p.id}">
    <h2>${esc(p.name)}</h2>
    ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
    <div class="row wrap">
      <button class="btn sm ${active ? '' : 'primary'}" data-act="current">${active ? 'Stop using as current' : 'Use as current project'}</button>
      <button class="btn sm danger" data-act="delproj">Delete project</button>
    </div>
    <h2>Tasks</h2>
    <div class="list">${p.tasks.map((t) => `<div class="item${t.done ? ' done' : ''}" data-task="${t.id}"><input type="checkbox" ${t.done ? 'checked' : ''} data-act="toggle" aria-label="Done"><div class="grow txt">${esc(t.text)}</div><button class="btn sm danger" data-act="deltask">✕</button></div>`).join('') || '<div class="empty">No tasks.</div>'}</div>
    <form class="row" data-form="task"><input name="t" placeholder="Add a task"><button class="btn sm primary">Add</button></form>
    <h2>Notes and decisions</h2>
    <div class="list">${p.notes.map((n) => `<div class="item" data-note="${n.id}"><div class="grow"><div class="kind">${n.kind}</div><div class="txt">${esc(n.text)}</div></div><button class="btn sm danger" data-act="delnote">✕</button></div>`).join('') || '<div class="empty">No notes.</div>'}</div>
    <form class="stack" data-form="note"><input name="t" placeholder="Add a note or decision"><div class="row"><select name="k"><option value="note">Note</option><option value="decision">Decision</option></select><button class="btn sm primary">Add</button></div></form>
    <h2>History</h2>
    <div class="history">${p.history.slice().reverse().map((h) => `<div>${fmtTime(h.at)} – ${esc(h.text)}</div>`).join('')}</div>
  </div>`;
}

// ---------- settings view ----------
async function renderSettings() {
  $('#setName').value = settings.userName;
  const sel = $('#setProvider');
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join('');
  sel.value = settings.brain.provider;
  renderProviderFields();
  $('#setWeb').checked = settings.webResearch;
  $('#setTeam').checked = settings.teamMode;
  const v = settings.voice;
  $('#setLang').value = v.lang;
  $('#setRate').value = v.rate;
  $('#setPitch').value = v.pitch;
  $('#setVolume').value = v.volume;
  $('#setAutoSpeak').checked = v.autoSpeak;
  $('#setHandsFree').checked = v.handsFree;
  updateRangeLabels();
  const sup = voice.voiceSupport();
  $('#voiceSupport').textContent = `Speaking: ${sup.tts ? 'available' : 'not available in this browser'} · Listening: ${sup.stt ? 'available (needs internet)' : 'not available in this browser'}`;
  const voices = await voice.getVoices();
  const vs = $('#setVoice');
  const auto = voice.pickVoice(voices, v);
  vs.innerHTML = `<option value="">Automatic${auto ? ` (${esc(auto.name)})` : ''}</option>` + voices.map((x) => `<option value="${esc(x.voiceURI)}">${esc(x.name)} – ${esc(x.lang)}</option>`).join('');
  vs.value = v.voiceURI || '';
  $('#aboutText').textContent = `J.A.R.V.I.S. version ${VERSION} · Mark II. Your data and your API key stay on this device. Source code in your private J.A.R.V.I.S GitHub repository.`;
}
function renderProviderFields() {
  const id = settings.brain.provider;
  const p = PROVIDERS[id];
  $('#providerNote').textContent = p.note;
  $('#customUrlRow').hidden = id !== 'custom';
  $('#setCustomUrl').value = settings.brain.customUrl || '';
  $('#setKey').value = '';
  $('#setKey').type = 'password';
  renderKeyStatus();
  const link = $('#keyLink');
  link.hidden = !p.keyUrl;
  if (p.keyUrl) link.href = p.keyUrl;
  $('#setModel').value = settings.brain.model || p.defaultModel || '';
  $('#brainResult').textContent = '';
}
function renderKeyStatus() {
  const id = settings.brain.provider;
  const p = PROVIDERS[id];
  const key = settings.brain.apiKeys[id] || '';
  $('#keyRow').hidden = !p.needsKey && id !== 'custom';
  $('#keyActions').hidden = $('#keyRow').hidden;
  $('#keyStatus').textContent = key ? `A key is saved on this phone (ends in …${key.slice(-4)}). Paste a new one to replace it.` : 'No key saved yet.';
  $('#setKey').placeholder = key ? 'Paste a new key to replace the saved one' : 'Paste your key';
  $('#removeKey').disabled = !key;
}
function saveKey(value) {
  const v = (value || '').trim();
  if (!v) return toast('Paste a key first');
  settings.brain.apiKeys[settings.brain.provider] = v;
  saveSettings();
  $('#setKey').value = '';
  renderKeyStatus();
  updateStatus();
  renderMessages();
  toast('Key saved on this phone. Tap Test connection.');
}
function updateRangeLabels() {
  $('#rateOut').textContent = Number($('#setRate').value).toFixed(2) + '×';
  $('#pitchOut').textContent = Number($('#setPitch').value).toFixed(2);
  $('#volOut').textContent = Math.round(Number($('#setVolume').value) * 100) + '%';
}

// ---------- events ----------
function bindEvents() {
  window.addEventListener('hashchange', showView);
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  const input = $('#input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    input.style.height = 'auto';
    handleSend(t);
  });
  $('#agentStrip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-agent]');
    if (!b) return;
    settings.agent = b.dataset.agent;
    saveSettings();
    renderAgentStrip();
  });
  $('#messages').addEventListener('click', (e) => {
    const s = e.target.closest('[data-suggest]');
    if (s) return handleSend(s.dataset.suggest);
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = act.closest('[data-id]').dataset.id;
    const m = memory.conversation().find((x) => x.id === id);
    if (!m) return;
    if (act.dataset.act === 'speak') speakReply(m.content);
    if (act.dataset.act === 'copy') navigator.clipboard && navigator.clipboard.writeText(m.content).then(() => toast('Copied'));
    if (act.dataset.act === 'remember') {
      try {
        memory.add({ text: m.content.slice(0, 500), kind: 'fact', source: 'reply' });
        toast('Saved to Memory');
      } catch (err) {
        toast(err.message);
      }
    }
  });
  $('#speakToggle').addEventListener('click', () => {
    settings.voice.autoSpeak = !settings.voice.autoSpeak;
    if (!settings.voice.autoSpeak) voice.stopSpeaking();
    saveSettings();
    updateStatus();
    toast(settings.voice.autoSpeak ? 'Replies will be read aloud' : 'Replies will not be read aloud');
  });

  // Agents
  $('#agentCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chat]');
    if (!b) return;
    settings.agent = b.dataset.chat;
    saveSettings();
    renderAgentStrip();
    location.hash = '#home';
  });

  // Memory
  $('#memoryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      memory.add({ text: $('#memoryText').value, kind: $('#memoryKind').value });
      $('#memoryText').value = '';
      renderMemory();
      toast('Remembered');
    } catch (err) {
      toast(err.message);
    }
  });
  $('#memorySearch').addEventListener('input', renderMemory);
  $('#memoryList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-mem]').dataset.mem;
    const m = memory.list().find((x) => x.id === id);
    if (b.dataset.act === 'del' && confirm('Delete this memory?')) {
      memory.remove(id);
      renderMemory();
    }
    if (b.dataset.act === 'edit' && m) {
      const t = prompt('Edit memory', m.text);
      if (t === null) return;
      try {
        if (!t.trim()) memory.remove(id);
        else memory.update(id, { text: t.trim() });
        renderMemory();
      } catch (err) {
        toast(err.message);
      }
    }
  });
  $('#clearConv').addEventListener('click', () => {
    if (!confirm('Clear the current conversation? Long-term memory and projects stay.')) return;
    memory.clearConversation();
    renderMessages();
    renderMemory();
    toast('Conversation cleared');
  });

  // Projects
  $('#projectForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const p = memory.addProject({ name: $('#projectName').value, description: $('#projectDesc').value });
      $('#projectName').value = '';
      $('#projectDesc').value = '';
      openProject = p.id;
      renderProjects();
    } catch (err) {
      toast(err.message);
    }
  });
  $('#projectList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-proj]');
    if (!b) return;
    openProject = b.dataset.proj;
    renderProjectDetail();
    $('#projectDetail').scrollIntoView({ behavior: 'smooth' });
  });
  $('#projectDetail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const pid = openProject;
    const act = b.dataset.act;
    if (act === 'current') {
      memory.setActiveProject(memory.activeProjectId() === pid ? null : pid);
      toast(memory.activeProjectId() ? 'JARVIS will keep this project in mind' : 'No current project');
    }
    if (act === 'delproj' && confirm('Delete this project and its notes?')) {
      memory.removeProject(pid);
      openProject = null;
    }
    if (act === 'toggle') memory.toggleTask(pid, b.closest('[data-task]').dataset.task);
    if (act === 'deltask') memory.removeTask(pid, b.closest('[data-task]').dataset.task);
    if (act === 'delnote') memory.removeNote(pid, b.closest('[data-note]').dataset.note);
    renderProjects();
  });
  $('#projectDetail').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.form === 'task') memory.addTask(openProject, f.t.value);
      if (f.dataset.form === 'note') memory.addNote(openProject, f.t.value, f.k.value);
    } catch (err) {
      toast(err.message);
    }
    renderProjects();
  });

  // Research
  $('#researchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#researchQ').value.trim();
    if (!q) return;
    $('#researchQ').value = '';
    settings.agent = 'simone';
    saveSettings();
    renderAgentStrip();
    location.hash = '#home';
    handleSend(q);
  });

  // Settings
  $('#setName').addEventListener('change', (e) => {
    settings.userName = e.target.value.trim();
    saveSettings();
    renderMessages();
    toast('Saved');
  });
  $('#setProvider').addEventListener('change', (e) => {
    settings.brain.provider = e.target.value;
    settings.brain.model = PROVIDERS[e.target.value].defaultModel || '';
    saveSettings();
    renderProviderFields();
    updateStatus();
    renderMessages();
  });
  $('#setCustomUrl').addEventListener('change', (e) => {
    settings.brain.customUrl = e.target.value.trim();
    saveSettings();
  });
  $('#saveKey').addEventListener('click', () => saveKey($('#setKey').value));
  $('#setKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(e.target.value); } });
  $('#showKey').addEventListener('click', () => {
    const k = $('#setKey');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('#showKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
  });
  $('#removeKey').addEventListener('click', () => {
    if (!confirm('Remove the saved key from this phone?')) return;
    delete settings.brain.apiKeys[settings.brain.provider];
    saveSettings();
    renderKeyStatus();
    updateStatus();
    renderMessages();
    $('#brainResult').textContent = '';
    toast('Key removed');
  });
  $('#setWeb').addEventListener('change', (e) => { settings.webResearch = e.target.checked; saveSettings(); });
  $('#setTeam').addEventListener('change', (e) => { settings.teamMode = e.target.checked; saveSettings(); });
  $('#setModel').addEventListener('change', (e) => {
    settings.brain.model = e.target.value.trim();
    saveSettings();
  });
  $('#loadModels').addEventListener('click', async () => {
    $('#brainResult').textContent = 'Loading models…';
    try {
      const models = await listModels(settings.brain);
      $('#modelList').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      $('#brainResult').textContent = models.length ? `${models.length} models found. Tap the Model box to pick one.` : 'No model list for this brain.';
    } catch (err) {
      $('#brainResult').textContent = err.message;
    }
  });
  $('#testBrain').addEventListener('click', async () => {
    if ($('#setKey').value.trim()) saveKey($('#setKey').value);
    $('#brainResult').textContent = 'Testing…';
    try {
      const reply = await chat(settings.brain, [{ role: 'user', content: 'Reply with exactly: JARVIS online' }], { timeoutMs: 30000 });
      $('#brainResult').textContent = `Connected. The brain replied: "${reply.slice(0, 80)}"`;
    } catch (err) {
      $('#brainResult').textContent = `Not working: ${err.message}`;
    }
  });
  const voiceField = (sel, key, cast = (x) => x) =>
    $(sel).addEventListener('input', (e) => {
      settings.voice[key] = cast(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      saveSettings();
      updateRangeLabels();
      updateStatus();
    });
  voiceField('#setRate', 'rate', Number);
  voiceField('#setPitch', 'pitch', Number);
  voiceField('#setVolume', 'volume', Number);
  voiceField('#setAutoSpeak', 'autoSpeak');
  voiceField('#setHandsFree', 'handsFree');
  $('#setVoice').addEventListener('change', (e) => {
    settings.voice.voiceURI = e.target.value;
    saveSettings();
  });
  $('#setLang').addEventListener('change', (e) => {
    settings.voice.lang = e.target.value;
    settings.voice.voiceURI = '';
    saveSettings();
    renderSettings();
    setupMicLang();
  });
  $('#testVoice').addEventListener('click', () => {
    const name = settings.userName ? `, ${settings.userName}` : '';
    voice.speak(`Good ${partOfDay()}${name}. All systems are online. How may I help?`, settings.voice);
  });
  $('#exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(memory.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded (your API key is not included)');
  });
  $('#importData').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      memory.importAll(JSON.parse(await file.text()));
      renderMessages();
      toast('Backup restored');
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });
  $('#wipeData').addEventListener('click', () => {
    if (!confirm('Delete ALL memory, projects, chats, settings and keys on this phone? This cannot be undone.')) return;
    memory.wipe();
    settings = loadSettings();
    renderAgentStrip();
    renderMessages();
    renderSettings();
    updateStatus();
    toast('Everything deleted');
  });
}
function setupMicLang() {
  // Recreate the listener so it uses the new language.
  const old = $('#micBtn');
  const fresh = old.cloneNode(true);
  old.replaceWith(fresh);
  setupMic();
}

// ---------- start ----------
function start() {
  bindEvents();
  renderAgentStrip();
  renderMessages();
  updateStatus();
  setupMic();
  showView();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__jarvis = { memory, store, VERSION };
}
start();
