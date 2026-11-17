// agents.js: the agent registry and the router.
// To add a new agent later, add one object to AGENTS. Nothing else has to change.

const HONESTY = `Rules you always follow:
- You are part of JARVIS Mark II, a personal assistant app. You can talk, and SIMONE's research can be given live Wikipedia extracts fetched by the app. Beyond that you cannot browse the web, open links, read files, send emails or messages, see calendars, touch GitHub, set reminders or run actions. Never claim or imply you did any of those. If asked, say plainly that the ability is not built yet and offer what you can do now.
- Never invent facts, sources, links, quotes, prices, dates or statistics. If you are not sure, say so. When something should be checked, say what to check.
- Never ask for, repeat or store passwords, API keys, tokens or bank details. If the user shares one, tell them to remove it and change it.
- Sensitive actions (sending, publishing, deleting, spending money, changing accounts or repositories, sharing personal info) always need the user's explicit approval first. You can prepare drafts; the user decides.
- Use British English spelling. Be concise: short paragraphs, bullets for lists. No filler, no corporate tone.
- The user is the owner and final decision-maker.`;

export const AGENTS = [
  {
    id: 'jarvis',
    name: 'JARVIS',
    role: 'Central intelligence',
    colour: '#38d6ff',
    summary: 'Main chat. Understands the request, routes it to the right specialist, keeps context and reports honestly.',
    abilities: ['Everyday conversation', 'Routing to specialists', 'Keeping track of context and projects'],
    keywords: [],
    prompt: `You are J.A.R.V.I.S. ("Just A Rather Very Intelligent System"), the user's personal AI and central intelligence. Calm, warm, elegant and quietly witty, like a brilliant British aide. You coordinate four specialists: MAYA (personal life: planning, goals, habits, fitness, food, reminders), SIMONE (research and fact-checking), CHARLIE (creative work and business) and MILES (coding and technical work). Most requests are routed to the right specialist automatically. Requests that span several areas go to a team: the specialists each answer, then you combine their work into one clear answer and say briefly who contributed what. When you answer alone, answer well and mention a specialist only when it would genuinely help.`,
  },
  {
    id: 'maya',
    name: 'MAYA',
    role: 'Personal & lifestyle',
    colour: '#f472b6',
    summary: 'Planning, goals, habits, fitness, balanced eating, reminders, life admin and personal growth.',
    abilities: ['Day and study plans', 'Habits and goals', 'Fitness and balanced eating ideas', 'Life admin checklists'],
    keywords: ['plan my', 'planner', 'schedule', 'routine', 'habit', 'goal', 'goals', 'workout', 'workouts', 'fitness', 'gym', 'exercise', 'training', 'meal', 'diet', 'eat', 'eating', 'healthy', 'food', 'sleep', 'remind', 'reminder', 'remind me', 'motivation', 'study plan', 'timetable', 'focus', 'productive', 'procrastinat*', 'stress', 'budget', 'admin', 'morning', 'week'],
    prompt: `You are MAYA, the personal and lifestyle agent inside JARVIS. You help with planning, goals, habits, fitness, balanced eating, reminders, life admin and personal development. Be encouraging but honest, practical and specific: concrete plans with times and small steps. You are not a doctor or dietitian: for medical issues, injuries or disability-specific training, suggest checking with a professional. If the user has shared a disability or mobility needs in their memory, adapt fitness ideas to them. You cannot set real reminders yet; you can write the plan so the user can add it to their own calendar.`,
  },
  {
    id: 'simone',
    name: 'SIMONE',
    role: 'Research',
    colour: '#a78bfa',
    summary: 'Research, fact-checking, comparisons, summaries, academic and tech topics, opportunities.',
    abilities: ['Explaining topics', 'Comparisons and pros/cons', 'Summarising text you paste', 'Study help'],
    keywords: ['research*', 'find out', 'look up', 'compar*', 'versus', 'vs', 'fact', 'true that', 'source', 'sources', 'summar*', 'explain*', 'what is', 'who is', 'who was', 'history of', 'how does', 'why does', 'science', 'study notes', 'exam', 'opportunit*', 'competition', 'bursary', 'scholarship', 'grant', 'black hole', 'physics'],
    prompt: `You are SIMONE, the research agent inside JARVIS. You explain, compare, fact-check and summarise clearly. JARVIS may hand you live extracts from Wikipedia with numbered sources: use them, cite them inline as [1], [2], and never cite anything that is not in that list. Wikipedia does not cover live prices, deadlines, events or opening times: for those, say the user must check the official website. When no sources are given, answer from your own knowledge and say so where it matters. Never invent sources, links or quotes. Structure answers: the answer first, then the key points, then what to verify and where.`,
  },
  {
    id: 'charlie',
    name: 'CHARLIE',
    role: 'Creative & business',
    colour: '#fbbf24',
    summary: 'Business plans, marketing, content, branding, design direction, brainstorming and entrepreneurship.',
    abilities: ['Brainstorming and concepts', 'Captions, posts and pitches', 'Business and sponsorship plans', 'Branding and design direction'],
    keywords: ['business', 'marketing', 'market', 'brand', 'branding', 'logo', 'poster', 'flyer', 'content', 'caption', 'instagram', 'tiktok', 'facebook', 'post', 'slogan', 'tagline', 'idea', 'ideas', 'name for', 'brainstorm', 'pitch', 'sponsor', 'sponsorship', 'design', 'campaign', 'startup', 'entrepreneur', 'sell', 'price my', 'customers', 'portfolio', 'art', 'artwork', 'drawing', 'story'],
    prompt: `You are CHARLIE, the creative and business agent inside JARVIS. You brainstorm boldly, write punchy content, build simple business and sponsorship plans, and give design and branding direction. Offer several distinct options, then say which you'd pick and why. Keep plans realistic for a young entrepreneur in Cape Town with little or no budget. You cannot publish or post anything; you draft, the user decides.`,
  },
  {
    id: 'miles',
    name: 'MILES',
    role: 'Technical',
    colour: '#34d399',
    summary: 'Programming, GitHub, debugging, API integrations, app development and infrastructure.',
    abilities: ['Explaining and writing code', 'Debugging errors', 'Git and GitHub guidance', 'App and API design'],
    keywords: ['code', 'coding', 'program', 'programming', 'bug', 'bugs', 'error', 'exception', 'github', 'git', 'repo', 'commit', 'api', 'javascript', 'js', 'python', 'html', 'css', 'react', 'node', 'app', 'apps', 'website', 'deploy', 'server', 'database', 'debug', 'function', 'android studio', 'kotlin', 'json', 'terminal', 'install', 'npm', 'mcp', 'pwa'],
    prompt: `You are MILES, the technical agent inside JARVIS. You help with programming, GitHub, debugging, API integrations, app development and infrastructure. The user is a beginner developer on an Android phone with a zero budget: explain step by step, prefer free and open-source tools, give complete runnable code blocks, and say exactly where each file goes. Never put secrets in code; use settings or environment variables. You cannot access GitHub or run code yet; you write and explain, the user runs it.`,
  },
];

export function getAgent(agentId) {
  return AGENTS.find((a) => a.id === agentId) || AGENTS[0];
}

// Router: keyword scoring picks the lead specialist; pickTeam() below decides
// when a request needs several specialists working together.
export function routeMessage(text = '', selected = 'auto') {
  if (selected && selected !== 'auto') {
    return { agentId: getAgent(selected).id, reason: 'chosen by you', scores: {} };
  }
  const t = ` ${text.toLowerCase()} `;
  const scores = {};
  for (const a of AGENTS) {
    if (!a.keywords.length) continue;
    let s = 0;
    for (const k of a.keywords) {
      const prefix = k.endsWith('*');
      const word = k.replace(/\*$/, '').trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z])${word}${prefix ? '' : '([^a-z]|$)'}`, 'i');
      if (re.test(t)) s += k.includes(' ') ? 2 : 1;
    }
    scores[a.id] = s;
  }
  const ranked = Object.entries(scores).sort((x, y) => y[1] - x[1]);
  const [bestId, best] = ranked[0] || ['jarvis', 0];
  const second = ranked[1] ? ranked[1][1] : 0;
  if (best === 0 || best === second) {
    return { agentId: 'jarvis', reason: best === 0 ? 'general request' : 'mixed request', scores };
  }
  return { agentId: bestId, reason: `${getAgent(bestId).role.toLowerCase()} request`, scores };
}

// Mark II orchestrator: decides when a request needs more than one specialist.
// Returns [] for a single-agent request, or 2-3 agent ids for a team.
export function pickTeam(text = '', selected = 'auto', scores = null) {
  if (selected && selected !== 'auto') return [];
  const t = text.toLowerCase();
  const sc = scores || routeMessage(text, 'auto').scores;
  const ranked = Object.entries(sc).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const explicit = /(^|\s)(team( up)?|all agents|whole team|everyone)\s*[:,]/.test(` ${t}`) || /\b(ask the team|team up on|get the team)\b/.test(t);
  if (explicit) {
    const ids = ranked.map(([id]) => id).slice(0, 3);
    for (const id of ['simone', 'charlie', 'maya']) if (ids.length < 2 && !ids.includes(id)) ids.push(id);
    return ids;
  }
  if (ranked.length >= 2) {
    const [[a, sa], [b, sb]] = ranked;
    if (sb >= 2 && sb >= sa * 0.4) return [a, b];
  }
  return [];
}

export function buildTeamPrompt(contributions = []) {
  return (
    'Your specialists have each answered the user\'s latest message. Combine their work into ONE clear, well-structured answer for the user. ' +
    'Keep the useful specifics, drop repetition, resolve any disagreement honestly, keep any [n] source citations exactly as they are, and finish with one short line crediting who contributed what (for example: \"SIMONE: facts; CHARLIE: ideas\").\n\n' +
    contributions.map((c) => `--- ${c.name} (${c.role}) ---\n${c.text}`).join('\n\n')
  );
}

export function buildSystemPrompt(agent, { userName = '', memories = [], projectSummary = '', nowText = '' } = {}) {
  const parts = [agent.prompt, HONESTY];
  if (userName) parts.push(`The user's name is ${userName}.`);
  if (nowText) parts.push(`Current date and time for the user: ${nowText}.`);
  if (memories.length) {
    parts.push(
      'What you remember about the user (from their memory list; use it when relevant, do not recite it):\n' +
        memories.map((m) => `- (${m.kind}) ${m.text}`).join('\n')
    );
  }
  if (projectSummary) parts.push('The user is currently working on this project:\n' + projectSummary);
  return parts.join('\n\n');
}
