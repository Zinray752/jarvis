// security.js: spots secrets (API keys, tokens, passwords, card numbers) so JARVIS
// never stores them as memory and never sends them to the AI model.

const PATTERNS = [
  { name: 'GitHub token', re: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/g },
  {
    name: 'API key',
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_[A-Za-z0-9]{16,}|pk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
  },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: 'password', re: /\b(?:password|passcode|passwd|pin|wagwoord)\b\s*(?:is|=|:)\s*\S+/gi },
  { name: 'card number', re: /\b(?:\d[ -]?){13,19}\b/g },
];

export function findSecrets(text = '') {
  const found = new Set();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(text)) found.add(p.name);
    p.re.lastIndex = 0;
  }
  return [...found];
}

export function redactSecrets(text = '') {
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.re, `[hidden ${p.name}]`);
  }
  return out;
}
