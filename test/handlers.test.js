'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandlers, buildContents, mockReply, extractAction, ACTION_NAMES, systemPrompt } = require('../lib/handlers');

const baseConfig = { mock: false, geminiApiKey: 'k', geminiModel: 'gemini-flash-lite-latest' };

test('chat: rejects empty / bad input', async () => {
  const h = createHandlers({ config: { ...baseConfig, mock: true } });
  assert.equal((await h.chat({})).status, 400);
  assert.equal((await h.chat({ message: '   ' })).status, 400);
  assert.equal((await h.chat({ message: 'x'.repeat(2001) })).status, 400);
  assert.equal((await h.chat({ message: 'hi', history: 'nope' })).status, 400);
});

test('chat: mock mode answers without any keys', async () => {
  const h = createHandlers({ config: { mock: true } });
  const out = await h.chat({ message: 'hello' });
  assert.equal(out.status, 200);
  assert.match(out.body.reply, /lovely to meet you/);
  assert.match(mockReply('who are you', 'Jarvis'), /Jarvis/);
  assert.equal(out.body.action, 'wave', 'greeting replies carry a wave action');
  assert.ok(!out.body.reply.includes('['), 'the tag is removed from the spoken text');
});

test('chat: missing key gives a clear 500', async () => {
  const out = await createHandlers({ config: { ...baseConfig, geminiApiKey: '' } }).chat({ message: 'hi' });
  assert.equal(out.status, 500);
  assert.match(out.body.error, /GEMINI_API_KEY/);
});

test('chat: sends model, assistant name and normalised history to Gemini', async () => {
  let seen;
  const fake = { models: { generateContent: async args => { seen = args; return { text: ' Hi friend! ' }; } } };
  const h = createHandlers({ config: { ...baseConfig, assistantName: 'Jarvis' }, geminiClient: fake });
  const out = await h.chat({ message: 'what next?', history: [
    { role: 'assistant', text: 'orphan model turn' },   // must be dropped (can't start with model)
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'hi!' },
    { role: 'hacker', text: 'ignored' }
  ] });
  assert.equal(out.status, 200);
  assert.equal(out.body.reply, 'Hi friend!');
  assert.equal(seen.model, 'gemini-flash-lite-latest');
  assert.match(seen.config.systemInstruction, /You are Jarvis/);
  assert.deepEqual(seen.contents.map(c => c.role), ['user', 'model', 'user']);
});

test('buildContents merges same-role turns and caps history', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i }));
  assert.ok(buildContents(many, 'now').length <= 14);
  assert.equal(buildContents([{ role: 'user', text: 'a' }], 'b').length, 1, 'two user turns merge into one');
});

test('chat: maps Gemini quota (429) and other errors without leaking details', async () => {
  const quota = { models: { generateContent: async () => { const e = new Error('RESOURCE_EXHAUSTED: quota'); e.status = 429; throw e; } } };
  assert.equal((await createHandlers({ config: baseConfig, geminiClient: quota }).chat({ message: 'hi' })).status, 429);
  const boom = { models: { generateContent: async () => { throw new Error('kaboom'); } } };
  const out = await createHandlers({ config: baseConfig, geminiClient: boom }).chat({ message: 'hi' });
  assert.equal(out.status, 502);
  assert.ok(!JSON.stringify(out.body).includes('kaboom'));
  const notFound = { models: { generateContent: async () => { const e = new Error('nf'); e.status = 404; throw e; } } };
  assert.match((await createHandlers({ config: baseConfig, geminiClient: notFound }).chat({ message: 'hi' })).body.error, /GEMINI_MODEL/);
});

test('chat: empty Gemini answer is reported', async () => {
  const empty = { models: { generateContent: async () => ({ text: '' }) } };
  assert.equal((await createHandlers({ config: baseConfig, geminiClient: empty }).chat({ message: 'hi' })).status, 502);
});

test('clientConfig: no secrets, sensible defaults', () => {
  const c = createHandlers({ config: { ...baseConfig, geminiApiKey: 'SECRET-KEY' } }).clientConfig();
  assert.ok(!JSON.stringify(c).includes('SECRET-KEY'));
  assert.deepEqual(c, { mock: false, speechLang: 'en-US', assistantName: 'Jarvis' });
  const d = createHandlers({ config: { ...baseConfig, speechLang: 'en-IN', assistantName: 'Friday' } }).clientConfig();
  assert.equal(d.speechLang, 'en-IN'); assert.equal(d.assistantName, 'Friday');
});

test('extractAction: finds one tag, cleans the text, ignores unknown brackets', () => {
  assert.deepEqual(extractAction('[wave] Hello there!'), { text: 'Hello there!', action: 'wave' });
  assert.deepEqual(extractAction('Sure thing [THUMBSUP] done.'), { text: 'Sure thing done.', action: 'thumbsup' });
  assert.deepEqual(extractAction('[ shrug ] I am not sure. [point]'), { text: 'I am not sure.', action: 'shrug' }, 'first tag wins, all tags removed');
  assert.deepEqual(extractAction('See note [1] and [dance].'), { text: 'See note [1] and [dance].', action: null }, 'unknown brackets stay');
  assert.deepEqual(extractAction('Plain reply'), { text: 'Plain reply', action: null });
  assert.deepEqual(extractAction(''), { text: '', action: null });
});

test('chat: real Gemini reply with a tag -> action returned, tag never reaches the voice', async () => {
  const fake = { models: { generateContent: async () => ({ text: '[thumbsup] Great choice!' }) } };
  const out = await createHandlers({ config: baseConfig, geminiClient: fake }).chat({ message: 'I picked the blue one' });
  assert.deepEqual(out.body, { reply: 'Great choice!', action: 'thumbsup' });
  const onlyTag = { models: { generateContent: async () => ({ text: '[wave]' }) } };
  assert.equal((await createHandlers({ config: baseConfig, geminiClient: onlyTag }).chat({ message: 'hi' })).status, 502, 'a reply that is only a tag is treated as empty');
});

test('system prompt names the assistant and lists every action', () => {
  const p = systemPrompt('Jarvis');
  assert.match(p, /You are Jarvis/);
  for (const a of ACTION_NAMES) assert.ok(p.includes(`[${a}]`), 'prompt mentions ' + a);
});
