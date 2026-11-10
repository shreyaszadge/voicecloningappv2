'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ACTION_NAMES } = require('../lib/handlers');

// public/actions.js is a browser ES module; load it here by stripping the "export" keywords.
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'actions.js'), 'utf8').replace(/^export\s+/gm, '');
const A = new Function(src + '\nreturn { ACTIONS, QUICK_ACTIONS, BEATS, IDLE_ACTIONS, IDLE_LINES, runAction, chooseAction, parseCommand, pick };')();

test('every action the AI may request exists in the browser, and every list only uses known actions', () => {
  for (const name of ACTION_NAMES) assert.ok(A.ACTIONS[name], 'browser knows ' + name);
  for (const list of [A.QUICK_ACTIONS, A.BEATS, A.IDLE_ACTIONS]) for (const n of list) assert.ok(A.ACTIONS[n], 'known: ' + n);
  for (const a of Object.values(A.ACTIONS)) { assert.ok(a.label && a.icon && a.gesture.length === 3); }
});

test('runAction plays the gesture and mood, and survives a missing or broken avatar', () => {
  const calls = [];
  const head = { setMood: m => calls.push(['mood', m]), playGesture: (...a) => calls.push(['gesture', ...a]) };
  assert.equal(A.runAction(head, 'wave'), true);
  assert.deepEqual(calls, [['mood', 'happy'], ['gesture', 'handup', 3, true]]);
  calls.length = 0;
  assert.equal(A.runAction(head, 'shrug'), true);
  assert.deepEqual(calls, [['gesture', 'shrug', 3, false]], 'no mood for a plain shrug');
  assert.equal(A.runAction(null, 'wave'), false);
  assert.equal(A.runAction(head, 'dance'), false);
  assert.equal(A.runAction({ setMood() { throw new Error('x'); }, playGesture() { throw new Error('y'); } }, 'wave'), true, 'engine errors are swallowed');
});

test('chooseAction reads the reply', () => {
  assert.equal(A.chooseAction('Good evening! I am Jarvis.'), 'wave');
  assert.equal(A.chooseAction("Sorry, I don't know that."), 'shrug');
  assert.equal(A.chooseAction('Thanks, that is great'), 'thumbsup');
  assert.equal(A.chooseAction('Here is a fun fact about bees'), 'point');
  assert.equal(A.chooseAction('Sure, I can do that'), 'ok');
  assert.equal(A.chooseAction('The capital is Paris'), null);
  assert.equal(A.chooseAction(''), null);
});

test('parseCommand only reacts to short action requests', () => {
  assert.equal(A.parseCommand('wave'), 'wave');
  assert.equal(A.parseCommand('Can you wave?'), 'wave');
  assert.equal(A.parseCommand('give me a thumbs up'), 'thumbsup');
  assert.equal(A.parseCommand('thumbs down'), 'thumbsdown');
  assert.equal(A.parseCommand('shrug!'), 'shrug');
  assert.equal(A.parseCommand('smile'), 'smile');
  assert.equal(A.parseCommand('please explain how a wave moves through water and why it breaks'), null, 'long questions are not commands');
  assert.equal(A.parseCommand('what is the weather'), null);
});

test('pick never returns the excluded item', () => {
  for (let i = 0; i < 50; i++) assert.notEqual(A.pick(['a', 'b', 'c'], 'a'), 'a');
});
