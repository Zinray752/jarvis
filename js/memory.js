// memory.js: JARVIS's three memory layers.
//  1. Short-term: the current conversation (recent messages).
//  2. Long-term: facts, preferences, goals, decisions and standing instructions.
//  3. Project memory: one record per project with its notes, tasks and history.
// All of it can be searched, edited and deleted by the user, and exported as a backup.

import { findSecrets } from './security.js';

export const MEMORY_KINDS = ['fact', 'preference', 'goal', 'decision', 'instruction'];
const MAX_CONVERSATION = 200;

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class SecretError extends Error {
  constructor(kinds) {
    super(`That looks like a ${kinds.join(' and ')}. JARVIS never stores secrets as memory.`);
    this.code = 'SECRET';
    this.kinds = kinds;
  }
}

const STOP = new Set(
  'a an the and or but of to in on at for with is are was were be been am i me my you your it its this that these those do does did what who how when where why can could would should will about from as by so if then than just please tell'.split(' ')
);

export function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function score(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const words = tokenize(text);
  let s = 0;
  for (const q of queryTokens) {
    for (const w of words) {
      if (w === q) s += 2;
      else if (w.startsWith(q) || q.startsWith(w)) s += 1;
    }
  }
  return s;
}

export function parseMemoryCommand(text = '') {
  const t = text.trim();
  let m = t.match(/^(?:jarvis[,:]?\s+)?(?:please\s+)?(?:remember|onthou)(?:\s+that)?[:,]?\s+(.+)$/i);
  if (m) return { action: 'remember', text: m[1].trim() };
  m = t.match(/^(?:jarvis[,:]?\s+)?(?:please\s+)?forget(?:\s+that)?[:,]?\s+(.+)$/i);
  if (m) return { action: 'forget', query: m[1].trim() };
  if (/^(?:jarvis[,:]?\s+)?what do you (?:remember|know about me)\??$/i.test(t)) return { action: 'list' };
  return null;
}

export function createMemory(store, { now = () => Date.now(), id = makeId } = {}) {
  const read = (k, d) => store.get(k, d);
  const write = (k, v) => store.set(k, v);

  const api = {
    // ---------- Long-term memory ----------
    list({ kind, projectId } = {}) {
      return read('memories', []).filter(
        (m) => (!kind || m.kind === kind) && (projectId === undefined || m.projectId === projectId)
      );
    },
    add({ text, kind = 'fact', projectId = null, source = 'user' }) {
      const clean = (text || '').trim();
      if (!clean) throw new Error('Memory text is empty.');
      const secrets = findSecrets(clean);
      if (secrets.length) throw new SecretError(secrets);
      if (!MEMORY_KINDS.includes(kind)) kind = 'fact';
      const all = read('memories', []);
      const dupe = all.find((m) => m.text.toLowerCase() === clean.toLowerCase() && m.projectId === projectId);
      if (dupe) return dupe;
      const item = { id: id(), text: clean, kind, projectId, source, createdAt: now(), updatedAt: now() };
      all.push(item);
      write('memories', all);
      return item;
    },
    update(memId, patch) {
      const all = read('memories', []);
      const i = all.findIndex((m) => m.id === memId);
      if (i < 0) return null;
      if (patch.text !== undefined) {
        const secrets = findSecrets(patch.text);
        if (secrets.length) throw new SecretError(secrets);
      }
      all[i] = { ...all[i], ...patch, id: all[i].id, updatedAt: now() };
      write('memories', all);
      return all[i];
    },
    remove(memId) {
      const all = read('memories', []);
      const next = all.filter((m) => m.id !== memId);
      write('memories', next);
      return next.length !== all.length;
    },
    search(query, { limit = 20 } = {}) {
      const q = tokenize(query);
      if (!q.length) return api.list().slice().reverse().slice(0, limit);
      return api
        .list()
        .map((m) => ({ m, s: score(q, m.text) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.m.updatedAt - a.m.updatedAt)
        .slice(0, limit)
        .map((x) => x.m);
    },
    // What gets handed to the AI with each message: standing instructions always,
    // plus the memories that best match what the user just said.
    relevant(query, { projectId = null, limit = 6 } = {}) {
      const all = api.list();
      const instructions = all.filter((m) => m.kind === 'instruction' && (!m.projectId || m.projectId === projectId));
      const q = tokenize(query);
      const matches = all
        .filter((m) => m.kind !== 'instruction' && (!m.projectId || m.projectId === projectId))
        .map((m) => ({ m, s: score(q, m.text) + (m.kind === 'preference' ? 0.5 : 0) }))
        .filter((x) => x.s > 0.5)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.m);
      // Always include a few recent preferences so JARVIS keeps the user's style.
      const prefs = all.filter((m) => m.kind === 'preference').slice(-3);
      const seen = new Set();
      return [...instructions, ...matches, ...prefs].filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
    },

    // ---------- Short-term memory (the conversation) ----------
    conversation() {
      return read('conversation', []);
    },
    appendMessage(msg) {
      const all = read('conversation', []);
      const item = { id: id(), at: now(), ...msg };
      all.push(item);
      write('conversation', all.slice(-MAX_CONVERSATION));
      return item;
    },
    clearConversation() {
      write('conversation', []);
    },
    recentContext(n = 12) {
      return api
        .conversation()
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
        .slice(-n)
        .map((m) => ({ role: m.role, content: m.content }));
    },

    // ---------- Project memory ----------
    projects() {
      return read('projects', []);
    },
    project(projectId) {
      return api.projects().find((p) => p.id === projectId) || null;
    },
    addProject({ name, description = '' }) {
      const clean = (name || '').trim();
      if (!clean) throw new Error('Project name is empty.');
      const secrets = findSecrets(clean + ' ' + description);
      if (secrets.length) throw new SecretError(secrets);
      const p = { id: id(), name: clean, description: description.trim(), status: 'active', tasks: [], notes: [], history: [{ at: now(), text: 'Project created' }], createdAt: now(), updatedAt: now() };
      write('projects', [...api.projects(), p]);
      return p;
    },
    updateProject(projectId, patch) {
      const all = api.projects();
      const i = all.findIndex((p) => p.id === projectId);
      if (i < 0) return null;
      all[i] = { ...all[i], ...patch, id: all[i].id, updatedAt: now() };
      write('projects', all);
      return all[i];
    },
    removeProject(projectId) {
      write('projects', api.projects().filter((p) => p.id !== projectId));
      write('memories', read('memories', []).filter((m) => m.projectId !== projectId));
      if (read('activeProject', null) === projectId) write('activeProject', null);
    },
    addTask(projectId, text) {
      const p = api.project(projectId);
      if (!p || !text.trim()) return null;
      const secrets = findSecrets(text);
      if (secrets.length) throw new SecretError(secrets);
      const task = { id: id(), text: text.trim(), done: false, at: now() };
      api.updateProject(projectId, { tasks: [...p.tasks, task], history: [...p.history, { at: now(), text: `Task added: ${task.text}` }] });
      return task;
    },
    toggleTask(projectId, taskId) {
      const p = api.project(projectId);
      if (!p) return null;
      let changed = null;
      const tasks = p.tasks.map((t) => (t.id === taskId ? (changed = { ...t, done: !t.done }) : t));
      if (!changed) return null;
      api.updateProject(projectId, { tasks, history: [...p.history, { at: now(), text: `${changed.done ? 'Done' : 'Reopened'}: ${changed.text}` }] });
      return changed;
    },
    removeTask(projectId, taskId) {
      const p = api.project(projectId);
      if (!p) return;
      api.updateProject(projectId, { tasks: p.tasks.filter((t) => t.id !== taskId) });
    },
    addNote(projectId, text, kind = 'note') {
      const p = api.project(projectId);
      if (!p || !text.trim()) return null;
      const secrets = findSecrets(text);
      if (secrets.length) throw new SecretError(secrets);
      const note = { id: id(), text: text.trim(), kind, at: now() };
      api.updateProject(projectId, { notes: [...p.notes, note], history: [...p.history, { at: now(), text: `${kind === 'decision' ? 'Decision' : 'Note'} added` }] });
      return note;
    },
    removeNote(projectId, noteId) {
      const p = api.project(projectId);
      if (!p) return;
      api.updateProject(projectId, { notes: p.notes.filter((n) => n.id !== noteId) });
    },
    activeProjectId() {
      return read('activeProject', null);
    },
    setActiveProject(projectId) {
      write('activeProject', projectId);
    },
    projectSummary(projectId) {
      const p = api.project(projectId);
      if (!p) return '';
      const open = p.tasks.filter((t) => !t.done).map((t) => `- [ ] ${t.text}`);
      const done = p.tasks.filter((t) => t.done).length;
      const notes = p.notes.slice(-8).map((n) => `- ${n.kind === 'decision' ? 'Decision: ' : ''}${n.text}`);
      return [`Project: ${p.name}`, p.description && `About: ${p.description}`, `Open tasks (${open.length}, ${done} done):`, ...open.slice(0, 15), notes.length && 'Notes and decisions:', ...notes]
        .filter(Boolean)
        .join('\n');
    },

    // ---------- Backup ----------
    exportAll() {
      return {
        app: 'JARVIS',
        version: 1,
        exportedAt: new Date(now()).toISOString(),
        memories: read('memories', []),
        projects: api.projects(),
        conversation: api.conversation(),
      };
    },
    importAll(data) {
      if (!data || data.app !== 'JARVIS') throw new Error('That file is not a JARVIS backup.');
      const safe = (arr) => (Array.isArray(arr) ? arr : []);
      write('memories', safe(data.memories).filter((m) => m && m.text && !findSecrets(m.text).length));
      write('projects', safe(data.projects));
      write('conversation', safe(data.conversation).slice(-MAX_CONVERSATION));
    },
    wipe() {
      for (const k of store.keys()) store.remove(k);
    },
  };
  return api;
}
