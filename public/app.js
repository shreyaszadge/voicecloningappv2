// AI Avatar Assistant frontend (vanilla JS, no framework).
// Flow: mic/text -> /api/chat (Gemini) -> reply -> browser voice + TalkingHead lip-sync.

import { splitSentences, estimateWordTimings, pickVoice } from './speech-helpers.js';
import { ACTIONS, QUICK_ACTIONS, BEATS, IDLE_ACTIONS, IDLE_LINES, runAction, chooseAction, parseCommand, pick } from './actions.js';
import { loadPrefs, savePrefs, listCustomAvatars, addCustomAvatar, removeCustomAvatar } from './store.js';

const $ = id => document.getElementById(id);
const els = {
  app: $('app'), avatar: $('avatar'), status: $('status'), statusText: $('statusText'), modeBadge: $('modeBadge'),
  brandName: $('brandName'), overlay: $('avatarOverlay'), overlayMsg: $('avatarMsg'), wakeHint: $('wakeHint'), wakeName: $('wakeName'),
  micBtn: $('micBtn'), micHint: $('micHint'), stopBtn: $('stopBtn'), settingsBtn: $('settingsBtn'),
  chat: $('chat'), chatTitle: $('chatTitle'), chatSub: $('chatSub'), expandBtn: $('expandBtn'), collapseBtn: $('collapseBtn'),
  messages: $('messages'), chips: $('chips'), indicator: $('indicator'), indWho: $('indWho'), indText: $('indText'),
  activity: $('activity'), form: $('chatForm'), input: $('textInput'), sendBtn: $('sendBtn'),
  actionsTray: $('actionsTray'), idleSel: $('idleSel'),
  fab: $('chatFab'), fabPreview: $('fabPreview'), fabBadge: $('fabBadge'),
  settings: $('settings'), settingsClose: $('settingsClose'), avatarGrid: $('avatarGrid'), addAvatarBtn: $('addAvatarBtn'), avatarFile: $('avatarFile'),
  bodySel: $('bodySel'), viewSel: $('viewSel'), tweakChk: $('tweakChk'),
  voiceSel: $('voiceSel'), rateRange: $('rateRange'), rateOut: $('rateOut'), syncRange: $('syncRange'), syncOut: $('syncOut'), testVoiceBtn: $('testVoiceBtn')
};

const AVATURN_BASELINE = { headRotateX: -0.05, eyeBlinkLeft: 0.15, eyeBlinkRight: 0.15 };
const STATUS_LABEL = { loading: 'Loading avatar', ready: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Error' };
const SUGGESTIONS = ['What can you do?', 'Tell me a fun fact', 'Help me plan my day'];
const MAX_HISTORY = 12;
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let config = { mock: false, speechLang: 'en-US', assistantName: 'Jarvis' };
let prefs = loadPrefs();
let head = null;              // TalkingHead instance (null if it could not load)
let avatars = [];             // every avatar we can show
let currentAvatar = null;
let history = [];             // [{role:'user'|'assistant', text}]
const flags = { busy: false, speaking: false, listening: false, typing: false };
let recognition = null;
let speakToken = 0;           // lets us ignore stale speech after Stop
let typingTimer = null;
let chatMode = 'normal';      // normal | expanded | collapsed
let unread = 0;
let voiceList = [];
let pendingGreeting = null;

const name = () => config.assistantName || 'Jarvis';
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let currentUtterance = null;  // keep a reference, otherwise Chrome can drop the utterance before it ends

/* ============================ small UI helpers ============================ */

function setStatus(state, text) {
  els.status.dataset.state = state;
  els.app.dataset.state = state;
  els.statusText.textContent = text || STATUS_LABEL[state];
  els.chatSub.textContent = state === 'ready' ? 'Online' : (text || STATUS_LABEL[state]);
}

// Back to rest: "Ready", or a lasting warning if the avatar could not be loaded.
function settleStatus() {
  if (!head) setStatus('error', 'Avatar unavailable'); else setStatus('ready');
}

function scrollToEnd() { els.messages.scrollTop = els.messages.scrollHeight; }

function typeInto(li, text) {
  li.classList.add('typing');
  const step = Math.max(1, Math.ceil(text.length / 90)); // always done in about 3 seconds
  let i = 0;
  const id = setInterval(() => {
    i = Math.min(text.length, i + step);
    li.textContent = text.slice(0, i);
    scrollToEnd();
    if (i >= text.length) { clearInterval(id); li.classList.remove('typing'); }
  }, 30);
}

function addMessage(kind, text, opts = {}) {
  const li = document.createElement('li');
  li.className = 'msg ' + kind;
  if (kind === 'user') li.dataset.who = 'You';
  if (kind === 'bot') li.dataset.who = name();
  els.messages.appendChild(li);
  if (opts.typewriter && !reducedMotion) typeInto(li, text); else li.textContent = text; // textContent: never inject model output as HTML
  scrollToEnd();
  if (kind === 'bot' && chatMode === 'collapsed') {
    unread++;
    els.fabBadge.textContent = String(unread); els.fabBadge.hidden = false;
    els.fabPreview.textContent = text.length > 60 ? text.slice(0, 57) + '…' : text;
  }
  return li;
}

function logActivity(text) {
  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString([], { hour12: false });
  li.append(t, document.createTextNode(text));
  els.activity.appendChild(li);
  while (els.activity.children.length > 5) els.activity.removeChild(els.activity.firstChild);
}

// "Who is doing what": the little line above the message box.
function refreshIndicator() {
  let who = null, text = '';
  if (flags.busy) { who = 'bot'; text = 'is thinking'; }
  else if (flags.speaking) { who = 'bot'; text = 'is speaking'; }
  else if (flags.listening) { who = 'you'; text = 'are speaking'; }
  else if (flags.typing) { who = 'you'; text = 'are typing'; }
  els.indicator.hidden = !who;
  if (who) {
    els.indWho.textContent = who === 'you' ? 'You' : name();
    els.indWho.dataset.who = who;
    els.indText.textContent = text;
  }
}

function setBusy(value) {
  flags.busy = value;
  els.sendBtn.disabled = value;
  refreshIndicator();
}

function showError(message) {
  setStatus('error');
  addMessage('system error', message);
  logActivity('Error: ' + message);
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Cannot reach the server. Is it running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

/* ============================ chat window: normal / expanded / collapsed ============================ */

function nudgeResize() {
  // The avatar canvas must follow the stage when the chat changes size.
  const go = () => { window.dispatchEvent(new Event('resize')); try { if (head && head.onResize) head.onResize(); } catch { /* ignore */ } };
  requestAnimationFrame(go);
  setTimeout(go, 350);
}

function setChatMode(mode, save = true) {
  chatMode = mode;
  els.app.dataset.chat = mode;
  els.fab.hidden = mode !== 'collapsed';
  els.chat.inert = mode === 'collapsed';
  els.chat.setAttribute('aria-hidden', String(mode === 'collapsed'));
  const expanded = mode === 'expanded';
  els.expandBtn.setAttribute('aria-label', expanded ? 'Restore chat size' : 'Expand chat');
  els.expandBtn.title = expanded ? 'Restore chat size' : 'Expand chat';
  if (mode !== 'collapsed') {
    unread = 0; els.fabBadge.hidden = true; els.fabPreview.textContent = 'Open chat';
    prefs.lastOpen = mode;
    scrollToEnd();
  }
  if (save) { prefs.chatMode = mode; savePrefs(prefs); }
  nudgeResize();
}

/* ============================ avatar ============================ */

// "my-face_v1.glb" -> "My Face V1" (same style as the avatars listed by the server)
function niceName(fileName) {
  const t = fileName.replace(/\.glb$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t ? t.replace(/\b\w/g, c => c.toUpperCase()) : 'My Avatar';
}

function entryFromRecord(rec) {
  return { id: 'mine-' + rec.id, recId: rec.id, name: rec.name, urls: [URL.createObjectURL(rec.blob)], body: rec.body || 'F', avaturn: true, baseline: null, source: 'mine', note: '' };
}

// Make sure a URL really serves a .glb model (not a 404 page or a Git LFS pointer) before handing it to TalkingHead.
async function checkModelUrl(url) {
  let res;
  try { res = await fetch(url); } catch { throw new Error('could not download'); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  reader.cancel().catch(() => {});
  const magic = value ? String.fromCharCode(...value.slice(0, 4)) : '';
  if (magic !== 'glTF') throw new Error('not a .glb model file');
}

function avatarBody(entry) { return (prefs.bodyById && prefs.bodyById[entry.id]) || entry.body || 'F'; }
function avatarTweak(entry) { return prefs.tweakById && entry.id in prefs.tweakById ? !!prefs.tweakById[entry.id] : !!entry.avaturn; }

async function showEntry(entry) {
  const baseline = entry.baseline || (avatarTweak(entry) ? AVATURN_BASELINE : null);
  let lastErr = new Error('no source');
  for (const url of entry.urls) {
    try {
      await checkModelUrl(url);
      await head.showAvatar({
        url, body: avatarBody(entry), lipsyncLang: 'en', avatarMood: 'neutral',
        avatarIdleEyeContact: 0.2,        // idle: the avatar does its own thing
        avatarSpeakingEyeContact: 1,      // speaking: always looks at you
        avatarListeningEyeContact: 1,     // listening: always looks at you
        avatarIgnoreCamera: false,
        ...(baseline ? { baseline } : {})
      }, ev => {
        if (ev && ev.lengthComputable) els.overlayMsg.textContent = `Loading ${entry.name}… ${Math.round((ev.loaded / ev.total) * 100)}%`;
      });
      return;
    } catch (err) { console.warn('Avatar source failed:', url, err); lastErr = err; }
  }
  throw lastErr;
}

function showOverlay(text) { els.overlay.classList.remove('hidden', 'failed'); els.overlayMsg.textContent = text; }
function hideOverlay() { els.overlay.classList.add('hidden'); }

async function loadInitialAvatar() {
  setStatus('loading');
  showOverlay('Loading avatar…');
  try {
    const { TalkingHead } = await import('talkinghead'); // dynamic: a CDN failure must not break the chat
    head = new TalkingHead(els.avatar, {
      lipsyncModules: ['en'],
      cameraView: prefs.view || 'upper',
      modelFPS: 24,                 // lighter on weak CPUs
      modelPixelRatio: 1,           // don't render at retina resolution
      cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false, // the face stays toward you
      avatarIdleEyeContact: 0.2, avatarSpeakingEyeContact: 1
    });
    const preferred = avatars.find(a => a.id === prefs.avatarId);
    const order = [...(preferred ? [preferred] : []), ...avatars.filter(a => a !== preferred)].slice(0, 4);
    const problems = [];
    for (const entry of order) {
      try {
        showOverlay(`Loading ${entry.name}…`);
        await showEntry(entry);
        currentAvatar = entry; prefs.avatarId = entry.id; savePrefs(prefs);
        hideOverlay(); setStatus('ready'); els.actionsTray.hidden = false;
        logActivity('Avatar ready: ' + entry.name);
        return true;
      } catch (err) { problems.push(`${entry.name} (${err.message})`); }
    }
    throw new Error(problems.join('; ') || 'no avatars available');
  } catch (err) {
    console.error('Avatar failed to load:', err);
    head = null; els.actionsTray.hidden = true;
    els.overlay.classList.remove('hidden'); els.overlay.classList.add('failed');
    els.overlayMsg.textContent = 'The avatar could not be loaded. You can still chat; replies will be spoken without the face.';
    setStatus('error', 'Avatar unavailable');
    addMessage('system error', 'Avatar failed to load: ' + err.message + '. See the README, section 2.');
    return false;
  }
}

async function switchAvatar(entry) {
  if (!head) { addMessage('system error', 'The avatar engine did not load, so avatars cannot be changed.'); return; }
  stopSpeaking();
  const previous = currentAvatar;
  showOverlay(`Loading ${entry.name}…`); setStatus('loading');
  try {
    await showEntry(entry);
    currentAvatar = entry; prefs.avatarId = entry.id; savePrefs(prefs);
    logActivity('Avatar changed: ' + entry.name);
    faceUser(3000);
  } catch (err) {
    addMessage('system error', `Could not load ${entry.name}: ${err.message}`);
    if (previous && previous.id !== entry.id) { try { await showEntry(previous); currentAvatar = previous; } catch { /* keep going */ } }
  } finally {
    hideOverlay(); settleStatus();
    renderAvatarGrid(); syncSettingsControls();
  }
}

// Make the avatar look at the person (eyes and head) for a moment.
let lastFace = 0;
function faceUser(ms = 3000, force = false) {
  if (!head) return;
  const now = performance.now();
  if (!force && now - lastFace < 1500) return;
  lastFace = now;
  try { if (head.makeEyeContact) head.makeEyeContact(ms); if (head.lookAtCamera) head.lookAtCamera(ms); } catch { /* optional */ }
}

function wakeAudio() { if (head && head.audioCtx && head.audioCtx.state === 'suspended') head.audioCtx.resume(); }

/* ============================ browser voice + lip-sync ============================ */

function loadVoices() {
  return new Promise(resolve => {
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const timer = setTimeout(() => resolve(synth.getVoices()), 1500);
    synth.addEventListener('voiceschanged', () => { clearTimeout(timer); resolve(synth.getVoices()); }, { once: true });
  });
}

function currentVoice() {
  return voiceList.find(v => v.name === prefs.voiceName) || pickVoice(voiceList, config.speechLang, '');
}

// How many ms per character this voice really takes. Learned after each sentence and remembered.
const calKey = (voice, rate) => `avatar.msPerChar:${voice ? voice.name : 'default'}|${rate}`;
function getMsPerChar(voice, rate) {
  try { const v = Number(localStorage.getItem(calKey(voice, rate))); if (v > 15 && v < 300) return v; } catch { /* storage blocked */ }
  return 65 / rate;
}
function saveMsPerChar(voice, rate, value) {
  try { localStorage.setItem(calKey(voice, rate), String(Math.round(value * 10) / 10)); } catch { /* storage blocked */ }
}

/** Speaks one sentence and starts the avatar's mouth at the moment the voice starts. */
function speakChunk(chunk, voice, rate, msPerChar, token, onStarted) {
  return new Promise((resolve, reject) => {
    const utt = new SpeechSynthesisUtterance(chunk);
    utt.lang = config.speechLang || 'en-US';
    utt.rate = rate;
    if (voice) utt.voice = voice;
    let startedAt = 0;
    const startGuard = setTimeout(() => {
      synth.cancel();
      reject(new Error('The browser voice did not start. Check your computer sound and that a voice is installed.'));
    }, 6000);

    utt.onstart = () => {
      clearTimeout(startGuard);
      startedAt = performance.now();
      onStarted();
      if (head && token === speakToken) {
        const est = estimateWordTimings(chunk, chunk.length * msPerChar);
        const offset = Number(prefs.lipsyncOffsetMs) || 0; // >0: mouth later, <0: mouth earlier
        const wtimes = offset < 0 ? est.wtimes.map(t => Math.max(0, t + offset)) : est.wtimes;
        const sr = head.audioCtx.sampleRate;
        // Silent audio of about the right length: TalkingHead needs an audio object to drive the mouth.
        const silent = head.audioCtx.createBuffer(1, Math.max(1, Math.round(sr * est.totalMs * 1.15 / 1000)), sr);
        const play = () => { if (token === speakToken) head.speakAudio({ audio: silent, words: est.words, wtimes, wdurations: est.wdurations }, { lipsyncLang: 'en' }); };
        if (offset > 0) setTimeout(play, offset); else play();
      }
    };
    utt.onend = () => { clearTimeout(startGuard); resolve({ started: startedAt > 0, actualMs: performance.now() - startedAt }); };
    utt.onerror = e => {
      clearTimeout(startGuard);
      if (e.error === 'canceled' || e.error === 'interrupted') resolve({ cancelled: true });
      else if (e.error === 'not-allowed') resolve({ blocked: true });
      else reject(new Error('Browser voice error: ' + (e.error || 'unknown')));
    };
    currentUtterance = utt;
    synth.speak(utt);
  });
}

function setSpeaking(value) {
  flags.speaking = value;
  els.stopBtn.disabled = !value;
  if (value) setStatus('speaking'); else if (!flags.busy && !flags.listening) settleStatus();
  refreshIndicator();
  if (!value) deferIdle();
}

async function speak(text, opts = {}) {
  if (!synth) { addMessage('system error', 'This browser has no built-in voice. Try Chrome or Edge.'); return; }
  const token = ++speakToken;
  setStatus('thinking', 'Preparing voice');
  const t0 = performance.now();
  if (!voiceList.length) voiceList = await loadVoices();
  if (token !== speakToken) return;
  const voice = currentVoice();
  const rate = Number(prefs.rate) || 1;
  const chunks = splitSentences(text);
  let lastBeat = null;

  for (let i = 0; i < chunks.length; i++) {
    const msPerChar = getMsPerChar(voice, rate);
    const result = await speakChunk(chunks[i], voice, rate, msPerChar, token, () => {
      if (i === 0) {
        logActivity(`Speaking (voice ready in ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
        if (opts.action && runAction(head, opts.action)) logActivity('Action: ' + ACTIONS[opts.action].label);
      } else if (head && Math.random() < 0.4) {
        lastBeat = pick(BEATS, lastBeat); runAction(head, lastBeat); // a small hand movement between sentences
      }
      faceUser(chunks[i].length * msPerChar + 800, true); // keep looking at the person for the whole sentence
      setSpeaking(true);
    });
    if (head) head.stopSpeaking(); // close the mouth when the voice ends, so the next sentence re-syncs
    if (result.blocked) { pendingGreeting = opts.greeting ? text : null; if (opts.greeting) armWakeHint(); setSpeaking(false); return; }
    if (result.cancelled || token !== speakToken) return;
    // Learn this voice's real speed so the next sentence is timed better.
    if (result.started && chunks[i].length >= 15 && result.actualMs > 200) {
      saveMsPerChar(voice, rate, 0.5 * msPerChar + 0.5 * (result.actualMs / chunks[i].length));
    }
  }
  if (token === speakToken) { setSpeaking(false); logActivity('Done speaking'); }
}

function stopSpeaking() {
  speakToken++;
  if (synth) synth.cancel();
  if (head) head.stopSpeaking();
  setSpeaking(false);
}

/* ============================ greeting ============================ */

function greetingText() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}! I'm ${name()}. How can I help you today?`;
}

const userHasActivation = () => !('userActivation' in navigator) || navigator.userActivation.hasBeenActive;

// Browsers do not allow sound before the first click or key press, so if needed we wait for it.
function armWakeHint() {
  if (!pendingGreeting) return;
  els.wakeHint.hidden = false;
  const go = () => {
    window.removeEventListener('click', go, true); window.removeEventListener('keydown', go, true);
    if (!pendingGreeting) return;
    const t = pendingGreeting; pendingGreeting = null; els.wakeHint.hidden = true;
    wakeAudio(); speak(t, { greeting: true, action: 'wave' }).catch(() => {});
  };
  window.addEventListener('click', go, true);
  window.addEventListener('keydown', go, true);
}

async function greet() {
  const text = greetingText();
  if (!synth) return;
  if (userHasActivation()) { try { await speak(text, { greeting: true, action: 'wave' }); } catch (err) { showError('Voice failed: ' + err.message); } }
  else { pendingGreeting = text; armWakeHint(); }
}

function showSuggestions() {
  els.chips.textContent = '';
  for (const s of SUGGESTIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = s;
    b.addEventListener('click', () => sendMessage(s));
    els.chips.appendChild(b);
  }
  els.chips.hidden = false;
}

/* ============================ conversation ============================ */

async function sendMessage(text) {
  text = (text || '').trim();
  if (!text || flags.busy) return;
  pendingGreeting = null; els.wakeHint.hidden = true;
  stopSpeaking(); wakeAudio();
  els.chips.hidden = true;
  flags.typing = false; clearTimeout(typingTimer);

  userActive();
  const command = parseCommand(text);
  if (command && runAction(head, command)) logActivity('Action: ' + ACTIONS[command].label);
  addMessage('user', text);
  els.input.value = '';
  setBusy(true);
  setStatus('thinking');
  logActivity(config.mock ? 'Asking the demo assistant…' : 'Asking Gemini…');
  faceUser(5000);

  try {
    const t0 = performance.now();
    const { reply, action } = await postJson('/api/chat', { message: text, history: history.slice(-MAX_HISTORY) });
    logActivity(`Reply ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    history.push({ role: 'user', text }, { role: 'assistant', text: reply });
    history = history.slice(-MAX_HISTORY);
    addMessage('bot', reply, { typewriter: true });
    setBusy(false);
    try { await speak(reply, { action: ACTIONS[action] ? action : chooseAction(reply) }); }
    catch (err) { showError('Voice failed: ' + err.message); }
  } catch (err) {
    setBusy(false);
    showError(err.message);
  } finally {
    if (flags.busy) setBusy(false);
    els.input.focus({ preventScroll: true });
  }
}

/* ============================ microphone ============================ */

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.micBtn.disabled = true;
    els.micHint.textContent = 'Mic needs Chrome or Edge';
    return;
  }
  recognition = new SR();
  recognition.lang = config.speechLang || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalText = '';
  recognition.onstart = () => {
    flags.listening = true; finalText = '';
    els.micBtn.setAttribute('aria-pressed', 'true');
    els.micBtn.setAttribute('aria-label', 'Stop microphone');
    els.micHint.textContent = 'Listening… tap to stop';
    setStatus('listening'); refreshIndicator();
    logActivity('Listening…'); faceUser(8000);
  };
  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    els.input.value = (finalText + interim).trim(); // show what is being heard
  };
  recognition.onerror = e => {
    const msgs = {
      'not-allowed': 'Microphone permission was blocked. Allow it in the browser address bar and try again.',
      'service-not-allowed': 'Microphone permission was blocked. Allow it in the browser address bar and try again.',
      'no-speech': 'I did not hear anything. Tap the microphone and try again.',
      'audio-capture': 'No microphone was found.',
      'network': 'Speech recognition needs an internet connection.'
    };
    if (e.error !== 'aborted') showError(msgs[e.error] || 'Speech recognition error: ' + e.error);
  };
  recognition.onend = () => {
    flags.listening = false;
    els.micBtn.setAttribute('aria-pressed', 'false');
    els.micBtn.setAttribute('aria-label', 'Start microphone');
    els.micHint.textContent = 'Tap to talk';
    const text = (finalText || '').trim();
    finalText = '';
    refreshIndicator();
    if (text) { logActivity(`Heard: “${text.length > 40 ? text.slice(0, 37) + '…' : text}”`); sendMessage(text); }
    else if (!flags.busy && els.status.dataset.state === 'listening') settleStatus();
  };
}

function toggleMic() {
  if (!recognition) return;
  if (flags.listening) { recognition.stop(); return; }
  pendingGreeting = null; els.wakeHint.hidden = true;
  stopSpeaking(); // so the avatar's own voice isn't picked up by the mic
  wakeAudio();
  try { recognition.start(); } catch { /* already started */ }
}

/* ============================ actions + idle behaviour ============================ */

function setupActions() {
  els.actionsTray.textContent = '';
  for (const key of QUICK_ACTIONS) {
    const a = ACTIONS[key];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'act-btn'; b.textContent = a.icon; b.title = a.label;
    b.setAttribute('aria-label', a.label); b.dataset.action = key;
    b.addEventListener('click', () => {
      userActive();
      if (runAction(head, key)) { faceUser(3000, true); logActivity('Action: ' + a.label); }
    });
    els.actionsTray.append(b);
  }
}

// When nobody is doing anything, the avatar moves a little and now and then says something.
const IDLE_SCALE = Number(window.__IDLE_SCALE) || 1; // (only used by the automatic tests)
const IDLE = { tick: 4000 * IDLE_SCALE, actionMin: 18000 * IDLE_SCALE, actionMax: 36000 * IDLE_SCALE, talkAfter: 100000 * IDLE_SCALE, maxTalks: 3 };
let nextIdleAction = 0, nextIdleTalk = 0, idleTalks = 0, lastIdleAction = null;
const between = (a, b) => a + Math.random() * (b - a);

function userActive() {
  const now = performance.now();
  idleTalks = 0;
  nextIdleAction = now + between(IDLE.actionMin, IDLE.actionMax);
  nextIdleTalk = now + IDLE.talkAfter;
}
function deferIdle() {
  const now = performance.now();
  nextIdleAction = Math.max(nextIdleAction, now + between(IDLE.actionMin, IDLE.actionMax));
  nextIdleTalk = Math.max(nextIdleTalk, now + IDLE.talkAfter * 0.6);
}
function idleTick() {
  const mode = prefs.idle || 'talk';
  if (mode === 'off' || !head || document.hidden || els.settings.open) return;
  if (flags.busy || flags.speaking || flags.listening || flags.typing || pendingGreeting) return;
  const now = performance.now();
  if (mode === 'talk' && idleTalks < IDLE.maxTalks && now >= nextIdleTalk && userHasActivation()) {
    const line = IDLE_LINES[idleTalks % IDLE_LINES.length];
    idleTalks++;
    nextIdleTalk = now + IDLE.talkAfter * 1.1; nextIdleAction = now + between(IDLE.actionMin, IDLE.actionMax);
    logActivity('Idle: speaking up');
    addMessage('bot', line, { typewriter: true });
    speak(line, { action: pick(IDLE_ACTIONS) }).catch(() => {});
    return;
  }
  if (now >= nextIdleAction) {
    lastIdleAction = pick(IDLE_ACTIONS, lastIdleAction);
    runAction(head, lastIdleAction);
    logActivity('Idle action: ' + ACTIONS[lastIdleAction].label);
    nextIdleAction = now + between(IDLE.actionMin, IDLE.actionMax);
  }
}

/* ============================ settings ============================ */

function renderAvatarGrid() {
  els.avatarGrid.textContent = '';
  const tags = { local: 'On this PC', sample: 'Sample', mine: 'Added by you' };
  for (const a of avatars) {
    const card = document.createElement('div');
    card.className = 'avatar-card' + (currentAvatar && currentAvatar.id === a.id ? ' active' : '');
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'pick'; pick.dataset.id = a.id;
    const mark = document.createElement('span'); mark.className = 'av-mark'; mark.textContent = (a.name[0] || '?').toUpperCase();
    const text = document.createElement('span'); text.className = 'av-text';
    const nm = document.createElement('span'); nm.className = 'av-name'; nm.textContent = a.name; nm.title = a.note || a.name;
    const tg = document.createElement('span'); tg.className = 'av-tag'; tg.textContent = tags[a.source] || '';
    text.append(nm, tg); pick.append(mark, text);
    pick.addEventListener('click', () => { if (!currentAvatar || currentAvatar.id !== a.id) switchAvatar(a); });
    card.append(pick);
    if (a.source === 'mine') {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'remove'; rm.textContent = '×'; rm.setAttribute('aria-label', 'Remove ' + a.name);
      rm.addEventListener('click', () => removeAvatar(a));
      card.append(rm);
    }
    els.avatarGrid.append(card);
  }
}

function renderVoiceSelect() {
  const sel = els.voiceSel;
  sel.textContent = '';
  const prefix = String(config.speechLang || 'en-US').toLowerCase().split('-')[0];
  const norm = s => String(s || '').toLowerCase().replace('_', '-');
  const same = voiceList.filter(v => norm(v.lang).startsWith(prefix));
  const other = voiceList.filter(v => !norm(v.lang).startsWith(prefix));
  const add = (group, label) => {
    if (!group.length) return;
    const og = document.createElement('optgroup'); og.label = label;
    for (const v of group) { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; og.append(o); }
    sel.append(og);
  };
  add(same, prefix.toUpperCase() + ' voices'); add(other, 'Other languages');
  if (!voiceList.length) { const o = document.createElement('option'); o.textContent = synth ? 'No voices found' : 'Voice not supported'; o.disabled = true; sel.append(o); }
  const cur = currentVoice();
  if (cur) sel.value = cur.name;
}

function syncSettingsControls() {
  if (currentAvatar) {
    els.bodySel.value = avatarBody(currentAvatar);
    els.tweakChk.checked = avatarTweak(currentAvatar);
  }
  els.bodySel.disabled = els.tweakChk.disabled = !currentAvatar;
  els.viewSel.value = prefs.view || 'upper';
  els.idleSel.value = prefs.idle || 'talk';
  els.rateRange.value = prefs.rate || 1; els.rateOut.textContent = (Number(prefs.rate) || 1).toFixed(2).replace(/0$/, '') + 'x';
  els.syncRange.value = prefs.lipsyncOffsetMs || 0; els.syncOut.textContent = (Number(prefs.lipsyncOffsetMs) || 0) + ' ms';
}

async function removeAvatar(entry) {
  if (!window.confirm(`Remove "${entry.name}" from this browser?`)) return;
  await removeCustomAvatar(entry.recId);
  entry.urls.forEach(u => URL.revokeObjectURL(u));
  avatars = avatars.filter(a => a !== entry);
  if (currentAvatar === entry) { currentAvatar = null; if (avatars[0]) await switchAvatar(avatars[0]); }
  renderAvatarGrid(); syncSettingsControls();
}

function setupSettings() {
  els.settingsBtn.addEventListener('click', () => { renderAvatarGrid(); renderVoiceSelect(); syncSettingsControls(); els.settings.showModal(); });
  els.settingsClose.addEventListener('click', () => els.settings.close());
  els.settings.addEventListener('click', e => { if (e.target === els.settings) els.settings.close(); }); // click on the dark backdrop

  els.addAvatarBtn.addEventListener('click', () => els.avatarFile.click());
  els.avatarFile.addEventListener('change', async () => {
    const file = els.avatarFile.files[0];
    els.avatarFile.value = '';
    if (!file) return;
    try {
      if (file.size > 120 * 1024 * 1024) throw new Error('That file is too large (maximum 120 MB).');
      const magic = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
      if (magic !== 'glTF') throw new Error('That is not a .glb model file.');
      const rec = { id: 'u' + Date.now().toString(36), name: niceName(file.name), blob: file, body: 'F' };
      const { persisted } = await addCustomAvatar(rec);
      const entry = entryFromRecord(rec);
      avatars.push(entry);
      renderAvatarGrid();
      if (!persisted) addMessage('system', 'This avatar is kept only until you close the tab (this browser mode cannot store files).');
      await switchAvatar(entry);
    } catch (err) { addMessage('system error', err.message); }
  });

  els.bodySel.addEventListener('change', () => {
    if (!currentAvatar) return;
    prefs.bodyById = { ...(prefs.bodyById || {}), [currentAvatar.id]: els.bodySel.value }; savePrefs(prefs);
    switchAvatar(currentAvatar);
  });
  els.tweakChk.addEventListener('change', () => {
    if (!currentAvatar) return;
    prefs.tweakById = { ...(prefs.tweakById || {}), [currentAvatar.id]: els.tweakChk.checked }; savePrefs(prefs);
    switchAvatar(currentAvatar);
  });
  els.viewSel.addEventListener('change', () => {
    prefs.view = els.viewSel.value; savePrefs(prefs);
    try { if (head) head.setView(prefs.view); } catch { /* optional */ }
  });
  els.idleSel.addEventListener('change', () => { prefs.idle = els.idleSel.value; savePrefs(prefs); });
  els.voiceSel.addEventListener('change', () => { prefs.voiceName = els.voiceSel.value; savePrefs(prefs); });
  els.rateRange.addEventListener('input', () => { prefs.rate = Number(els.rateRange.value); savePrefs(prefs); syncSettingsControls(); });
  els.syncRange.addEventListener('input', () => { prefs.lipsyncOffsetMs = Number(els.syncRange.value); savePrefs(prefs); syncSettingsControls(); });
  els.testVoiceBtn.addEventListener('click', () => {
    stopSpeaking(); wakeAudio();
    speak('Hello! This is how I sound. How does my lip sync look?').catch(err => showError('Voice failed: ' + err.message));
  });
}

/* ============================ start ============================ */

function setupEvents() {
  els.form.addEventListener('submit', e => { e.preventDefault(); sendMessage(els.input.value); });
  els.micBtn.addEventListener('click', toggleMic);
  els.stopBtn.addEventListener('click', stopSpeaking);
  els.collapseBtn.addEventListener('click', () => setChatMode('collapsed'));
  els.expandBtn.addEventListener('click', () => setChatMode(chatMode === 'expanded' ? 'normal' : 'expanded'));
  els.fab.addEventListener('click', () => { setChatMode(prefs.lastOpen || 'normal'); els.input.focus(); });

  // "You are typing…" and eye contact while the person writes
  els.input.addEventListener('input', () => {
    flags.typing = els.input.value.trim().length > 0;
    clearTimeout(typingTimer);
    if (flags.typing) typingTimer = setTimeout(() => { flags.typing = false; refreshIndicator(); }, 1500);
    refreshIndicator();
    if (flags.typing) faceUser(4000);
  });
  els.input.addEventListener('focus', () => faceUser(3000));

  // Do not waste CPU on animations while the tab is hidden
  document.addEventListener('pointerdown', userActive, true);
  document.addEventListener('keydown', userActive, true);
  document.addEventListener('visibilitychange', () => els.app.classList.toggle('paused', document.hidden));
  if (synth) synth.addEventListener('voiceschanged', () => { voiceList = synth.getVoices(); renderVoiceSelect(); });
}

(async function init() {
  try { config = { ...config, ...(await (await fetch('/api/config')).json()) }; } catch { /* use defaults */ }
  els.brandName.textContent = els.chatTitle.textContent = els.wakeName.textContent = name();
  document.title = `${name()} · AI Avatar Assistant`;
  els.input.placeholder = `Message ${name()}…`;
  els.modeBadge.hidden = !config.mock;

  setupEvents(); setupSettings(); setupMic(); setupActions();
  userActive(); setInterval(idleTick, IDLE.tick);
  setChatMode(prefs.chatMode && ['normal', 'expanded', 'collapsed'].includes(prefs.chatMode) ? prefs.chatMode : 'normal', false);
  if (prefs.view) els.viewSel.value = prefs.view;

  // avatars: files on this PC + samples (from the server) + ones you added in the browser
  let server = [];
  try { server = (await (await fetch('/api/avatars')).json()).avatars || []; } catch { /* no list */ }
  const custom = (await listCustomAvatars()).map(entryFromRecord);
  avatars = [...server.filter(a => a.source === 'local'), ...custom, ...server.filter(a => a.source !== 'local')];

  // the greeting appears at once as text
  const greeting = greetingText();
  addMessage('bot', greeting, { typewriter: true });
  showSuggestions();
  if (config.mock) addMessage('system', 'Demo mode: replies are pre-written. Add your Gemini key to talk to the real AI.');
  logActivity('System online');

  const voicesReady = synth ? loadVoices().then(v => { voiceList = v; }) : Promise.resolve();
  await loadInitialAvatar();
  await voicesReady;
  faceUser(3000);
  await greet(); // ...and is spoken as soon as the browser allows sound
})();
