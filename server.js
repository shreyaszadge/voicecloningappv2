'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const { createHandlers } = require('./lib/handlers');
const { listAvatars } = require('./lib/avatars');

const PUBLIC_DIR = path.join(__dirname, 'public');
const config = {
  port: Number(process.env.PORT) || 3000,
  mock: String(process.env.MOCK_MODE).toLowerCase() === 'true',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  geminiThinking: process.env.GEMINI_THINKING,
  speechLang: process.env.SPEECH_LANG || 'en-US',
  assistantName: (process.env.ASSISTANT_NAME || 'Jarvis').trim().slice(0, 30) || 'Jarvis'
};

const handlers = createHandlers({ config });
const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR));

app.post('/api/chat', async (req, res) => {
  const started = Date.now();
  const out = await handlers.chat(req.body || {});
  console.log(`POST /api/chat -> ${out.status} in ${Date.now() - started} ms`); // shows how long Gemini took
  res.status(out.status).json(out.body);
});
app.get('/api/config', (req, res) => res.json(handlers.clientConfig()));
app.get('/api/avatars', (req, res) => res.json({ avatars: listAvatars({ dir: path.join(PUBLIC_DIR, 'avatars') }) }));

// invalid JSON etc.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(config.port, () => {
  console.log(`${config.assistantName} is running at http://localhost:${config.port}`);
  console.log('Voice: your browser\'s built-in voice (no key needed).');
  if (config.mock) console.log('MOCK_MODE is ON: using dummy replies (no API keys needed).');
  else if (!config.geminiApiKey) console.warn('Warning: GEMINI_API_KEY is not set.');
});
