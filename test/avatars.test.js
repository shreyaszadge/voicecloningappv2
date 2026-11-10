'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listAvatars, prettify } = require('../lib/avatars');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'avs-'));

test('prettify makes readable names', () => {
  assert.equal(prettify('my-face_v2.glb'), 'My Face V2');
  assert.equal(prettify('.glb'), 'Avatar');
});

test('listAvatars: samples only when the folder is empty or missing', () => {
  for (const dir of [tmp(), path.join(os.tmpdir(), 'does-not-exist-' + Date.now())]) {
    const list = listAvatars({ dir });
    assert.deepEqual(list.map(a => a.id), ['sample-avaturn', 'sample-mpfb', 'sample-brunette']);
    assert.ok(list.every(a => a.urls.length === 2 && a.urls.every(u => u.startsWith('https://'))));
  }
});

test('listAvatars: local .glb files come first, manifest adds names and settings', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'me.glb'), 'x');
  fs.writeFileSync(path.join(dir, 'Other Person.GLB'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'avatars.json'), JSON.stringify([
    { file: 'me.glb', name: 'My face', body: 'M', avaturn: true, baseline: { headRotateX: -0.1, bad: 'x' } },
    { file: 'ghost.glb', name: 'not on disk' }
  ]));
  const list = listAvatars({ dir });
  const local = list.filter(a => a.source === 'local');
  assert.deepEqual(local.map(a => a.name), ['Other Person', 'My face']);
  const me = local.find(a => a.name === 'My face');
  assert.equal(me.body, 'M'); assert.equal(me.avaturn, true);
  assert.deepEqual(me.baseline, { headRotateX: -0.1 }, 'non-numeric baseline values are dropped');
  assert.deepEqual(me.urls, ['/avatars/me.glb']);
  assert.equal(local.find(a => a.name === 'Other Person').urls[0], '/avatars/Other%20Person.GLB');
  assert.equal(list.findIndex(a => a.source === 'sample'), 2, 'samples after local files');
  assert.ok(!list.some(a => a.name === 'not on disk'));
});

test('listAvatars: broken manifest is ignored, includeSamples=false works', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.glb'), 'x');
  fs.writeFileSync(path.join(dir, 'avatars.json'), '{not json');
  const list = listAvatars({ dir, includeSamples: false });
  assert.deepEqual(list.map(a => a.name), ['A']);
});
