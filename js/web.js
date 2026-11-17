// web.js: SIMONE's live research. Uses Wikipedia's free public API (no key,
// no account, works straight from the phone). Returns real pages with real links,
// so every source JARVIS shows you exists.

const FILLER = new Set(('can could would you please pls research find out look up search for about on into tell me give me ' +
  'explain summarise summarize what who where when why how is are was were the a an of for to and do does did i me my some ' +
  'quick quickly simply simple facts fact info information more detail details simone jarvis').split(' '));

// Turns "Can you research black holes for me?" into "black holes".
export function researchQuery(text = '') {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f' -]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w));
  return (kept.length ? kept : words).slice(0, 10).join(' ').trim();
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Returns [{ title, url, extract }] in relevance order, or [] when nothing matches.
export async function wikiResearch(text, { fetchImpl = globalThis.fetch, limit = 3, lang = 'en', timeoutMs = 12000 } = {}) {
  const q = researchQuery(text);
  if (!q) return [];
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const search = await getJson(
    fetchImpl,
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${limit}&format=json&origin=*`,
    timeoutMs
  );
  const titles = ((search.query && search.query.search) || []).map((r) => r.title);
  if (!titles.length) return [];
  const pages = await getJson(
    fetchImpl,
    `${base}?action=query&prop=extracts%7Cinfo&inprop=url&exintro=1&explaintext=1&exlimit=${titles.length}` +
      `&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`,
    timeoutMs
  );
  const byTitle = {};
  for (const p of Object.values((pages.query && pages.query.pages) || {})) {
    if (p && p.title && !p.missing) byTitle[p.title] = p;
  }
  return titles
    .map((t) => byTitle[t])
    .filter((p) => p && p.extract)
    .map((p) => ({
      title: p.title,
      url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      extract: p.extract.replace(/\s+/g, ' ').trim().slice(0, 1500),
    }));
}

// The block handed to SIMONE with the user's question.
export function sourcesPrompt(sources = []) {
  if (!sources.length) return '';
  return (
    'Live sources JARVIS just fetched from Wikipedia for this question. Base your answer on them where they are relevant, ' +
    'cite them inline as [1], [2] and so on, and do not cite anything that is not in this list. If they do not cover the ' +
    'question, say so and answer from your own knowledge, clearly marked as such:\n\n' +
    sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.extract}`).join('\n\n')
  );
}
