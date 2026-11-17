// llm.js: talks to the AI model (the "brain").
// Every provider here speaks the same OpenAI-style chat format, so switching brains
// is just a setting. The API key stays on the phone and is only sent to that provider.

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (free API key)',
    chatUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    needsKey: true,
    defaultModel: 'gemini-3.5-flash-lite',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier with daily limits, no card needed. Default model: gemini-3.5-flash-lite (Google\'s pick for new projects). On the free tier Google may use your messages to improve its products, so do not share private details.',
  },
  groq: {
    label: 'Groq (free API key)',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Fast open models with a free tier. Tap "Load models" after adding your key and pick one.',
  },
  openrouter: {
    label: 'OpenRouter (free models, API key)',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Pick a model whose name ends in ":free" to stay at R0.',
  },
  custom: {
    label: 'Custom (any OpenAI-compatible server)',
    chatUrl: '',
    modelsUrl: '',
    needsKey: false,
    defaultModel: '',
    keyUrl: null,
    note: 'For example a model running on your own computer. Enter its chat completions URL.',
  },
};

export class LlmError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

// Models Google has retired or restricted for new users; old saved choices are cleared
// so the app falls back to the current default.
export const RETIRED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
export function migrateBrain(brain = {}) {
  const b = { ...brain };
  if (b.provider === 'gemini' && RETIRED_MODELS.includes((b.model || '').trim())) b.model = '';
  return b;
}

export function buildChatRequest(brain, messages) {
  const p = PROVIDERS[brain.provider] || PROVIDERS.gemini;
  const url = brain.provider === 'custom' ? brain.customUrl : p.chatUrl;
  if (!url) throw new LlmError('No server address set for the custom brain. Add it in Settings.', 'config');
  const model = (brain.model || p.defaultModel || '').trim();
  if (!model) throw new LlmError('No model chosen yet. In Settings, tap "Load models" and pick one.', 'config');
  const key = (brain.apiKeys && brain.apiKeys[brain.provider]) || '';
  if (p.needsKey && !key) throw new LlmError(`This brain needs a free API key. Add it in Settings → Brain.`, 'config');
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = { model, messages, temperature: 0.7 };
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

export function parseChatResponse(data) {
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (Array.isArray(text)) return text.map((x) => x.text || '').join('').trim();
  throw new LlmError('The brain sent back an empty answer. Try again.', 'empty');
}

export function explainHttpError(status, bodyText = '') {
  if ((status === 400 || status === 401 || status === 403) && /api[ _-]?key/i.test(bodyText)) return new LlmError('The API key was refused. Check it in Settings \u2192 Brain, or create a new one.', 'auth');
  if (status === 400) return new LlmError(`The brain rejected the request (400). Check the model name in Settings. ${bodyText.slice(0, 160)}`, 'bad_request');
  if (status === 401 || status === 403) return new LlmError('The API key was refused. Check it in Settings → Brain, or create a new one.', 'auth');
  if (status === 404) return new LlmError('That model or address was not found. Tap "Load models" in Settings and pick one.', 'not_found');
  if (status === 429) return new LlmError('The free limit was hit. Wait a minute and try again, or switch brain in Settings.', 'rate_limit');
  if (status >= 500) return new LlmError(`The brain's server had a problem (${status}). Try again shortly.`, 'server');
  return new LlmError(`Unexpected reply from the brain (${status}).`, 'unknown');
}

export async function chat(brain, messages, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const { url, init } = buildChatRequest(brain, messages);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl ? ctrl.signal : undefined });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new LlmError('The brain took too long to answer. Try again.', 'timeout');
    throw new LlmError('Could not reach the brain. Check your internet connection.', 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    let t = '';
    try {
      t = await res.text();
    } catch {}
    throw explainHttpError(res.status, t);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new LlmError('The brain sent back something that was not valid JSON.', 'parse');
  }
  return parseChatResponse(data);
}

export async function listModels(brain, { fetchImpl = globalThis.fetch } = {}) {
  const p = PROVIDERS[brain.provider];
  const url = brain.provider === 'custom' ? (brain.customUrl || '').replace(/\/chat\/completions\/?$/, '/models') : p && p.modelsUrl;
  if (!url) return p && p.defaultModel ? [p.defaultModel] : [];
  const key = (brain.apiKeys && brain.apiKeys[brain.provider]) || '';
  const res = await fetchImpl(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw explainHttpError(res.status, '');
  const data = await res.json();
  const ids = (data.data || data.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  return [...new Set(ids)].sort();
}
