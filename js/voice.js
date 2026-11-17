// voice.js: free, built-in voice using the phone's own speech engines (Web Speech API).
// Speaking uses the voices installed on the phone; listening uses Chrome's speech
// recognition, which needs an internet connection.

const FEMALE = /(female|woman|serena|kate|libby|sonia|hazel|susan|amy|emma|martha|fiona|stephanie|moira|tessa|karen|samantha|victoria|zira|aria|jenny|-gbb-|-gba-|en-gb-x-gba|en-gb-x-gbc|en-gb-x-gbd)/i;
const MALE = /(\bmale\b|\bman\b|daniel|george|ryan|arthur|oliver|thomas|james|david|mark|guy|-gbd-|rishi|en-gb-x-rjs)/i;

// Scores a voice for the default JARVIS voice: British English, feminine, local first.
export function scoreVoice(v, { lang = 'en-GB' } = {}) {
  const vl = (v.lang || '').replace('_', '-').toLowerCase();
  const want = lang.toLowerCase();
  let s = 0;
  if (vl === want) s += 6;
  else if (vl.split('-')[0] === want.split('-')[0]) s += 2;
  const name = `${v.name} ${v.voiceURI || ''}`;
  if (FEMALE.test(name) && !/\bmale\b/i.test(name.replace(/female/gi, ''))) s += 3;
  else if (MALE.test(name)) s -= 3;
  if (/google/i.test(name)) s += 1; // usually the most natural on Android
  if (v.localService) s += 0.5;
  return s;
}

export function pickVoice(voices, prefs = {}) {
  if (!voices || !voices.length) return null;
  if (prefs.voiceURI) {
    const exact = voices.find((v) => v.voiceURI === prefs.voiceURI || v.name === prefs.voiceURI);
    if (exact) return exact;
  }
  return voices.slice().sort((a, b) => scoreVoice(b, prefs) - scoreVoice(a, prefs))[0];
}

// Turns the model's markdown into something pleasant to hear.
export function speakableText(md = '') {
  return md
    .replace(/```[\s\S]*?```/g, ' (code shown on screen) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link on screen')
    .replace(/[*_#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Long utterances can cut off on some Android phones, so speak in sentence-sized chunks.
export function chunkText(text, max = 220) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export function voiceSupport() {
  const w = globalThis;
  return {
    tts: !!(w.speechSynthesis && w.SpeechSynthesisUtterance),
    stt: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
  };
}

export function getVoices() {
  return new Promise((resolve) => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return resolve([]);
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener ? synth.addEventListener('voiceschanged', finish, { once: true }) : (synth.onvoiceschanged = finish);
    setTimeout(finish, 1500);
  });
}

export async function speak(text, prefs = {}, { onEnd } = {}) {
  const synth = globalThis.speechSynthesis;
  if (!synth) {
    onEnd && onEnd();
    return false;
  }
  synth.cancel();
  const voices = await getVoices();
  const voice = pickVoice(voices, prefs);
  const chunks = chunkText(speakableText(text));
  if (!chunks.length) {
    onEnd && onEnd();
    return false;
  }
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = prefs.lang || 'en-GB';
    u.rate = Number(prefs.rate) || 1;
    u.pitch = Number(prefs.pitch) || 1;
    u.volume = prefs.volume === undefined ? 1 : Number(prefs.volume);
    if (i === chunks.length - 1) u.onend = () => onEnd && onEnd();
    synth.speak(u);
  });
  return true;
}

export function stopSpeaking() {
  if (globalThis.speechSynthesis) globalThis.speechSynthesis.cancel();
}

export function createListener({ lang = 'en-GB', onText, onInterim, onState, onError }) {
  const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Rec) return null;
  const rec = new Rec();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onstart = () => onState && onState('listening');
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim && onInterim(finalText + interim);
  };
  rec.onerror = (e) => {
    const msg =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone permission was refused. Allow it in Chrome site settings.'
        : e.error === 'no-speech'
        ? "I didn't catch anything. Tap the mic and try again."
        : e.error === 'network'
        ? 'Speech recognition needs an internet connection.'
        : `Voice input error: ${e.error}`;
    onError && onError(msg, e.error);
  };
  rec.onend = () => {
    onState && onState('idle');
    const t = finalText.trim();
    finalText = '';
    if (t && onText) onText(t);
  };
  return {
    start() {
      try {
        rec.start();
      } catch (e) {
        if (e && e.name !== 'InvalidStateError') onError && onError(`Could not start the microphone: ${e.message}`, 'start');
      }
    },
    stop() {
      try {
        rec.stop();
      } catch {}
    },
  };
}
