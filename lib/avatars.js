'use strict';
/**
 * The avatars the browser can offer.
 *  1) every .glb file in public/avatars/  (optional extra info in public/avatars/avatars.json)
 *  2) a few sample avatars hosted in the TalkingHead project (loaded from the internet)
 * Avatars the user adds in the browser are stored in the browser itself and are not listed here.
 */
const fs = require('fs');
const path = require('path');

const RAW = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/';
const CDN = 'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/avatars/';

const SAMPLES = [
  { id: 'sample-avaturn', file: 'avatar.glb', name: 'Avaturn sample', body: 'F', avaturn: true, note: 'Made with Avaturn. Non-commercial use.' },
  { id: 'sample-mpfb', file: 'mpfb.glb', name: 'MPFB human', body: 'F', avaturn: false, note: 'Made with Blender + MPFB. CC0 license.' },
  { id: 'sample-brunette', file: 'brunette.glb', name: 'Brunette', body: 'F', avaturn: false, note: 'Ready Player Me style. Non-commercial (CC BY-NC).' }
];

function prettify(file) {
  const s = file.replace(/\.glb$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.replace(/\b\w/g, c => c.toUpperCase()) : 'Avatar';
}

function readManifest(dir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'avatars.json'), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function cleanBaseline(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

function listAvatars({ dir, includeSamples = true } = {}) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.glb$/i.test(f)).sort(); } catch { /* folder missing */ }
  const manifest = readManifest(dir);
  for (const f of files) {
    const m = manifest.find(x => x && x.file === f) || {};
    out.push({
      id: 'local-' + f.replace(/\.glb$/i, ''),
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 40) : prettify(f),
      urls: ['/avatars/' + encodeURIComponent(f)],
      body: m.body === 'M' ? 'M' : 'F',
      avaturn: !!m.avaturn,
      baseline: cleanBaseline(m.baseline),
      source: 'local',
      note: ''
    });
  }
  if (includeSamples) {
    for (const s of SAMPLES) {
      out.push({ id: s.id, name: s.name, urls: [RAW + s.file, CDN + s.file], body: s.body, avaturn: s.avaturn, baseline: null, source: 'sample', note: s.note });
    }
  }
  return out;
}

module.exports = { listAvatars, prettify, SAMPLES };
