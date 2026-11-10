// What the avatar can DO (hand gestures and faces), and how we decide when to do it.
// Gesture names are TalkingHead's: handup, index, ok, thumbup, thumbdown, side, shrug, or an emoji.

export const ACTIONS = {
  wave:       { label: 'Wave',        icon: '👋', gesture: ['handup', 3, true],    mood: 'happy' },
  thumbsup:   { label: 'Thumbs up',   icon: '👍', gesture: ['thumbup', 3, false],  mood: 'happy' },
  thumbsdown: { label: 'Thumbs down', icon: '👎', gesture: ['thumbdown', 3, false], mood: 'sad' },
  shrug:      { label: 'Shrug',       icon: '🤷', gesture: ['shrug', 3, false] },
  point:      { label: 'Point',       icon: '☝️', gesture: ['index', 3, false] },
  ok:         { label: 'OK',          icon: '👌', gesture: ['ok', 3, false] },
  smile:      { label: 'Smile',       icon: '😊', gesture: ['😊', 3, false],       mood: 'happy' },
  think:      { label: 'Think',       icon: '🤔', gesture: ['🤔', 3, false] },
  sad:        { label: 'Sad',         icon: '😔', gesture: ['😔', 3, false],       mood: 'sad' },
  explain:    { label: 'Explain',     icon: '🫱', gesture: ['side', 3, false] }
};

// The buttons shown on the stage
export const QUICK_ACTIONS = ['wave', 'thumbsup', 'shrug', 'point', 'ok', 'smile', 'think'];
// Small "talking with my hands" moves between sentences
export const BEATS = ['explain', 'point', 'ok'];
// Quiet things to do while nobody is talking
export const IDLE_ACTIONS = ['smile', 'think', 'point', 'shrug', 'ok', 'explain'];

export const IDLE_LINES = [
  "I'm still here. Tap the microphone or type whenever you need me.",
  'Want to hear a fun fact? Just ask me.',
  'If you need anything, just say the word.'
];

/** Perform an action on the avatar. Returns false if it cannot (no avatar or unknown action). */
export function runAction(head, name) {
  const a = ACTIONS[name];
  if (!head || !a) return false;
  try { if (a.mood) { head.setMood(a.mood); setTimeout(() => { try { head.setMood('neutral'); } catch { /* optional */ } }, (a.gesture[1] + 1) * 1000); } } catch { /* optional */ }
  try { head.playGesture(a.gesture[0], a.gesture[1], a.gesture[2]); } catch { /* optional */ }
  return true;
}

/** Backup when the AI gave no action: pick one from the words of the reply. */
export function chooseAction(text) {
  const t = String(text || '');
  if (/\b(hello|hi there|hey there|welcome|good (morning|afternoon|evening)|goodbye|bye|see you)\b/i.test(t)) return 'wave';
  if (/\b(sorry|unfortunately|i can'?t|cannot|unable|don'?t know|do not know|not sure|no idea)\b/i.test(t)) return 'shrug';
  if (/\b(thank you|thanks|great|awesome|excellent|well done|congratulations|perfect|glad|happy to help|you'?re welcome)\b/i.test(t)) return 'thumbsup';
  if (/\b(fun fact|for example|here'?s|here is|let me explain|first,|note that)\b/i.test(t)) return 'point';
  if (/\b(sure|of course|absolutely|alright|okay|yes)\b/i.test(t)) return 'ok';
  return null;
}

/** "wave", "do a thumbs up", "shrug"... typed or spoken as a short command. */
export function parseCommand(text) {
  const t = String(text || '').toLowerCase().trim().replace(/[.!?]+$/g, '');
  if (!t || t.split(/\s+/).length > 6) return null;
  if (/\b(wave|say hi|say hello)\b/.test(t)) return 'wave';
  if (/thumbs?[ -]?up/.test(t)) return 'thumbsup';
  if (/thumbs?[ -]?down/.test(t)) return 'thumbsdown';
  if (/\bshrug\b/.test(t)) return 'shrug';
  if (/\b(point|index finger)\b/.test(t)) return 'point';
  if (/\bok(ay)? sign\b|\bgive me an ok\b/.test(t)) return 'ok';
  if (/\b(smile|grin)\b/.test(t)) return 'smile';
  if (/\b(think|thinking)\b/.test(t)) return 'think';
  return null;
}

export function pick(list, not) {
  const options = list.filter(x => x !== not);
  return options[Math.floor(Math.random() * options.length)];
}
