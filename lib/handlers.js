'use strict';
/**
 * Framework-free request handlers. Each returns { status, body }.
 * server.js plugs them into Express. The Gemini client is injectable so this can be tested without a key.
 * (Voice is the browser's own, so there is no text-to-speech code on the server.)
 */

const MAX_TEXT = 2000;
const MAX_HISTORY = 12;

// Actions the avatar can perform. The browser has a matching list in public/actions.js.
const ACTION_NAMES = ['wave', 'thumbsup', 'thumbsdown', 'shrug', 'point', 'ok', 'smile', 'think', 'sad'];

function systemPrompt(name) {
  return [
    `You are ${name}, a friendly, warm, human-like voice assistant shown as a talking avatar.`,
    'Your replies are spoken aloud, so keep them natural and short: usually one to three sentences.',
    'Use plain spoken English. No markdown, no bullet points, no emojis.',
    'Ask at most one short follow-up question when it feels natural.',
    'Your avatar can act. You may start a reply with ONE action tag in square brackets: ' +
      '[wave] for greetings and goodbyes, [thumbsup] for praise or agreement, [thumbsdown] for disagreement or bad news, ' +
      '[shrug] when you are not sure, [point] when explaining something, [ok] to confirm, [smile] for a friendly moment, ' +
      '[think] when pondering, [sad] for sympathy. Use a tag in about half of your replies, never more than one, ' +
      'and never use any other square brackets.'
  ].join(' ');
}

/* ---------- helpers ---------- */

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Pull the action tag (e.g. "[wave]") out of a reply. Returns the clean spoken text and the action name. */
function extractAction(text) {
  let action = null;
  const re = new RegExp('\\[\\s*(' + ACTION_NAMES.join('|') + ')\\s*\\]', 'gi');
  const cleaned = String(text || '').replace(re, (m, found) => { if (!action) action = found.toLowerCase(); return ' '; })
    .replace(/[ \t]{2,}/g, ' ').trim();
  return { text: cleaned, action };
}

/** Validate + normalise history into Gemini "contents" (roles: user/model, starts with user). */
function buildContents(history, message) {
  const turns = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-MAX_HISTORY)) {
      const text = clean(h && h.text).slice(0, MAX_TEXT);
      if (!text) continue;
      const role = h.role === 'user' ? 'user' : (h.role === 'assistant' || h.role === 'model') ? 'model' : null;
      if (role) turns.push({ role, text });
    }
  }
  turns.push({ role: 'user', text: message });
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += '\n' + t.text;
    else merged.push({ ...t });
  }
  return merged.map(t => ({ role: t.role, parts: [{ text: t.text }] }));
}

function mapGeminiError(err) {
  const status = Number(err && (err.status || err.code)) || 0;
  const msg = String((err && err.message) || err || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return { status: 429, body: { error: 'Gemini quota or rate limit reached. Wait a minute and try again.' } };
  }
  if (status === 400 && /API key/i.test(msg)) {
    return { status: 502, body: { error: 'Gemini rejected the API key. Check GEMINI_API_KEY in .env.' } };
  }
  if (status === 401 || status === 403) {
    return { status: 502, body: { error: 'Gemini refused the request (key invalid or not allowed).' } };
  }
  if (status === 404) {
    return { status: 502, body: { error: 'Gemini model not found. Check GEMINI_MODEL in .env.' } };
  }
  return { status: 502, body: { error: 'Gemini request failed. Please try again.' } };
}

/**
 * Gemini "thinking" makes replies slower. Newer models use thinkingLevel, Gemini 2.5 uses thinkingBudget,
 * and which one works depends on the model behind GEMINI_MODEL. So in "auto" mode we try
 * low level -> budget 0 -> nothing, and remember the first one the API accepts.
 * GEMINI_THINKING can force: off | minimal | low | medium | high | <number budget>.
 */
function thinkingVariants(setting) {
  const v = String(setting || 'auto').trim().toLowerCase();
  if (v === 'off' || v === 'none') return [null];
  if (['minimal', 'low', 'medium', 'high'].includes(v)) return [{ thinkingLevel: v }];
  if (/^\d+$/.test(v)) return [{ thinkingBudget: Number(v) }];
  return [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];
}

/* ---------- mock replies (MOCK_MODE) ---------- */

function mockReply(message, name = 'Jarvis') {
  const m = message.toLowerCase();
  if (/what can you do|help me plan|what do you do/.test(m)) return "[point] I can chat, answer questions and help you think things through. Just ask me anything!";
  if (/fun fact/.test(m)) return "[point] Here's a fun one: honey never spoils. People have found edible honey in ancient tombs.";
  if (/\b(hi|hello|hey|namaste)\b/.test(m)) return "[wave] Hi there! It's lovely to meet you. How is your day going?";
  if (/your name|who are you/.test(m)) return `[smile] I'm ${name}, your talking avatar. Right now I'm in demo mode, so my answers are pre-written.`;
  if (/how are you/.test(m)) return "[smile] I'm doing great, thanks for asking! What would you like to talk about?";
  if (/weather/.test(m)) return "[shrug] I can't check the weather in demo mode, but I hope it's sunny where you are.";
  if (/thank/.test(m)) return "[thumbsup] You're very welcome! Happy to help anytime.";
  if (/bye|goodbye/.test(m)) return "[wave] Goodbye! It was nice talking with you.";
  return "[think] That's interesting! In demo mode I can only give simple replies, but add your Gemini key and I'll answer properly.";
}

/* ---------- factory ---------- */

function createHandlers({ config, geminiClient }) {
  let genai = geminiClient || null;
  const variants = thinkingVariants(config.geminiThinking);
  let variantIdx = 0;
  const name = config.assistantName || 'Jarvis';

  function getGemini() {
    if (!genai) {
      const { GoogleGenAI } = require('@google/genai'); // loaded lazily so mock mode needs no SDK
      genai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return genai;
  }

  async function generate(contents) {
    for (;;) {
      const thinking = variants[variantIdx];
      try {
        return await getGemini().models.generateContent({
          model: config.geminiModel,
          contents,
          // No "temperature": newer Gemini models reject it. maxOutputTokens leaves room for thinking.
          config: { systemInstruction: systemPrompt(name), maxOutputTokens: 1024, ...(thinking ? { thinkingConfig: thinking } : {}) }
        });
      } catch (err) {
        const status = Number(err && (err.status || err.code)) || 0;
        const msg = String((err && err.message) || '');
        // Only step down when the API is complaining about the thinking setting itself.
        if (variantIdx < variants.length - 1 && (status === 400 || !status) && /think/i.test(msg)) { variantIdx++; continue; }
        throw err;
      }
    }
  }

  async function chat(body) {
    const message = clean(body && body.message);
    if (!message) return { status: 400, body: { error: 'Please send a non-empty "message".' } };
    if (message.length > MAX_TEXT) return { status: 400, body: { error: `Message is too long (max ${MAX_TEXT} characters).` } };
    if (body.history !== undefined && !Array.isArray(body.history)) {
      return { status: 400, body: { error: '"history" must be an array.' } };
    }

    if (config.mock) {
      await new Promise(r => setTimeout(r, 400)); // feel like "thinking"
      const { text, action } = extractAction(mockReply(message, name));
      return { status: 200, body: { reply: text, action, mock: true } };
    }
    if (!config.geminiApiKey && !geminiClient) {
      return { status: 500, body: { error: 'GEMINI_API_KEY is missing. Add it to .env or set MOCK_MODE=true.' } };
    }
    try {
      const response = await generate(buildContents(body.history, message));
      const { text: reply, action } = extractAction(clean(response && response.text));
      if (!reply) return { status: 502, body: { error: 'Gemini returned an empty answer (it may have been blocked). Try rephrasing.' } };
      return { status: 200, body: { reply, action } };
    } catch (err) {
      console.error('[chat] Gemini error:', err && err.message);
      return mapGeminiError(err);
    }
  }

  function clientConfig() {
    return {
      mock: !!config.mock,
      speechLang: config.speechLang || 'en-US',
      assistantName: name
    };
  }

  return { chat, clientConfig };
}

module.exports = { createHandlers, thinkingVariants, buildContents, mockReply, mapGeminiError, systemPrompt, extractAction, ACTION_NAMES };
