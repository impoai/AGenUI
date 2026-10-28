// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntime, applyPatch } from '../dist/index.js';
import { fixture } from '../example/fixture.js';

async function until(condition, message) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await delay(5);
  }
}
async function setup(t) {
  const errors = [], events = [];
  const runtime = await createRuntime({ onError: error => errors.push(error) });
  t.after(() => runtime.dispose());
  for (const type of ['Text', 'TextField', 'CheckBox', 'Slider', 'Divider']) {
    runtime.registerMeasurement(type, () => ({ width: 240, height: 48 }));
  }
  const session = runtime.createSession({ width: 800, onEvent: e => events.push(e) });
  session.render(fixture());
  await until(() => session.surfaces.get('travel')?.has('submit-label'), 'initial components');
  return { runtime, session, events, errors };
}
const node = (session, id, surface = 'travel') => session.surfaces.get(surface)?.get(id);
const update = (surfaceId, value) => JSON.stringify({ version: 'v0.9', updateDataModel: { surfaceId, path: '/', value } });

test('local calculator actions update bound state without agent events or cross-session writes', async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.dispose());
  runtime.registerMeasurement('Text', () => ({ width: 200, height: 48 }));
  const events = [];
  const session = runtime.createSession({ onEvent: e => events.push(e) });
  const other = runtime.createSession();
  const buttons = [
    ['digit', { call: 'formatString', args: { value: '${/expression}2' } }],
    ['operator', { call: 'formatString', args: { value: '${/expression}+' } }],
    ['equals', { call: 'calculate', args: { expression: { path: '/expression' } } }],
    ['clear', ''],
  ].flatMap(([id, value]) => [
    { id, component: 'Button', child: id + 'Label', action: { functionCall: { call: 'setValue', args: { targetPath: '/expression', value } } } },
    { id: id + 'Label', component: 'Text', text: id },
  ]);
  const document = [
    { createSurface: { surfaceId: 'calc' } },
    { updateDataModel: { surfaceId: 'calc', path: '/', value: { expression: '' } } },
    { updateComponents: { surfaceId: 'calc', components: [
      { id: 'root', component: 'Column', children: ['display', 'digit', 'operator', 'equals', 'clear', 'send'] },
      { id: 'display', component: 'Text', text: { path: '/expression' } },
      ...buttons,
      { id: 'send', component: 'Button', child: 'sendLabel', action: { event: { name: 'Send result', context: { result: { path: '/expression' } } } } },
      { id: 'sendLabel', component: 'Text', text: 'Send result to agent' },
    ] } },
  ].map(value => JSON.stringify({ version: 'v0.9', ...value })).join('\n');
  session.render(document); other.render(document);
  await until(() => node(session, 'display', 'calc') && node(other, 'display', 'calc'), 'calculator render');
  for (const [key, expected] of [['digit', '2'], ['operator', '2+'], ['digit', '2+2'], ['equals', '4']]) {
    session.action('calc', key);
    await until(() => node(session, 'display', 'calc').text === expected, key);
  }
  runtime.setTheme('dark'); session.resize('calc', 600, 800);
  await delay(30);
  assert.equal(node(session, 'display', 'calc').text, '4');
  assert.equal(node(other, 'display', 'calc').text, '');
  assert.equal(events.filter(e => e.type === 'action').length, 0);
  session.action('calc', 'send');
  await until(() => events.some(e => e.type === 'action'), 'explicit agent action');
  assert.deepEqual(events.find(e => e.type === 'action').value.action.context, { result: '4' });
  for (const [expression, expected] of [['(2+3)*4', '20'], ['0.1+0.2', '0.3'], ['1/0', 'Cannot divide by zero'], ['globalThis.fetch(1)', 'Invalid expression'], ['9'.repeat(600), 'Invalid expression']]) {
    session.render(update('calc', { expression }));
    session.action('calc', 'equals');
    await until(() => node(session, 'display', 'calc').text === expected, expression.slice(0, 20));
  }
  session.action('calc', 'clear');
  await until(() => node(session, 'display', 'calc').text === '', 'clear after error');
  assert.equal(events.filter(e => e.type === 'action').length, 1);
});

test('ships a real Wasm module built from the upstream core', async t => {
  const bytes = await readFile(new URL('../dist/agenui.wasm', import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 97, 115, 109]);
  const { runtime, session } = await setup(t);
  assert.match(runtime.version, /^1\.7\.0/);
  assert.equal(node(session, 'mirror').text, 'Paris');
  assert.equal(node(session, 'root').styles.width, 800);
  assert.ok(node(session, 'submit').styles.y > node(session, 'city').styles.y);
});
test('edited text, boolean and numeric values resolve inside C++ action context', async t => {
  const { session, events, errors } = await setup(t);
  session.change('travel', 'city', { value: 'Tokyo 🌸' });
  session.change('travel', 'outdoors', { value: false });
  session.change('travel', 'days', { value: 7 });
  session.action('travel', 'submit');
  await until(() => events.some(e => e.type === 'action'), 'action callback');
  assert.equal(node(session, 'mirror').text, 'Tokyo 🌸');
  assert.deepEqual(events.find(e => e.type === 'action').value.action.context,
    { city: 'Tokyo 🌸', outdoors: false, days: 7 });
  assert.deepEqual(errors, []);
});
test('fragmented protocol and Unicode use the same core parser', async t => {
  const { runtime } = await setup(t);
  const session = runtime.createSession();
  const input = fixture('fragmented').replaceAll('Paris', 'Zürich 🌻');
  session.begin();
  const characters = Array.from(input);
  for (let i = 0; i < characters.length; i += 13) session.push(characters.slice(i, i + 13).join(''));
  session.end();
  await until(() => node(session, 'mirror', 'fragmented'), 'fragmented document');
  assert.equal(node(session, 'mirror', 'fragmented').text, 'Zürich 🌻');
});
test('server data patches and width changes update existing component snapshots', async t => {
  const { session } = await setup(t);
  session.begin(); session.push(update('travel', { city: 'Oslo', outdoors: true, days: 3 })); session.end();
  session.resize('travel', 420, 1200);
  await until(() => node(session, 'mirror').text === 'Oslo' && node(session, 'root').styles.width === 420, 'patch and layout');
  assert.equal(node(session, 'city').value, 'Oslo');
});
test('different managers isolate identical surface IDs and action state', async t => {
  const { runtime, session } = await setup(t);
  const second = runtime.createSession(); second.render(fixture());
  await until(() => node(second, 'city'), 'second session');
  session.change('travel', 'city', { value: 'Berlin' });
  await until(() => node(session, 'mirror').text === 'Berlin', 'first edit');
  assert.equal(node(second, 'city').value, 'Paris');
  second.dispose();
  session.change('travel', 'city', { value: 'Lisbon' });
  await until(() => node(session, 'mirror').text === 'Lisbon', 'live sibling after disposal');
});
test('component removal and surface deletion reconcile snapshots', async t => {
  const { session } = await setup(t);
  session.render(JSON.stringify({ version: 'v0.9', updateComponents: { surfaceId: 'travel', components: [
    { id: 'root', component: 'Column', children: ['heading'] },
  ] } }));
  await until(() => !node(session, 'city'), 'removed child');
  assert.ok(node(session, 'heading'));
  session.render(JSON.stringify({ version: 'v0.9', deleteSurface: { surfaceId: 'travel' } }));
  await until(() => !session.surfaces.has('travel'), 'deleted surface');
});
test('dispose cancels pending work, suppresses late events and rejects reuse', async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.dispose());
  const events = [];
  const session = runtime.createSession({ onEvent: e => events.push(e) });
  session.render(fixture());
  session.dispose(); session.dispose();
  await delay(50);
  assert.equal(events.length, 0);
  assert.throws(() => session.push('x'), /disposed/);
  runtime.dispose(); runtime.dispose();
  assert.throws(() => runtime.createSession(), /disposed/);
});
test('invalid API dimensions and oversized streams fail before entering the core', async t => {
  const { runtime, session } = await setup(t);
  assert.throws(() => runtime.createSession({ width: NaN }), /width/);
  assert.throws(() => session.resize('travel', -1, 5), /width/);
  assert.throws(() => session.push('x'.repeat(1048577)), /limited/);
  assert.throws(() => runtime.setTheme('automatic'), /Theme/);
});
test('null property diffs remove values and cannot poison object prototypes', () => {
  const value = applyPatch({ label: 'old', styles: { width: 10 } }, JSON.parse('{"label":null,"styles":{"width":20},"__proto__":{"polluted":true}}'));
  assert.equal(value.label, undefined);
  assert.deepEqual(value.styles, { width: 20 });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(value), null);
});
test('consumer callback exceptions do not break later core events', async t => {
  const { session, errors } = await setup(t);
  const unsubscribe = session.subscribe(() => { throw new Error('host failure'); });
  session.change('travel', 'city', { value: 'Rome' });
  await until(() => errors.length > 0, 'host error reported');
  unsubscribe();
  session.change('travel', 'city', { value: 'Madrid' });
  await until(() => node(session, 'mirror').text === 'Madrid', 'core still alive');
});
test('custom components receive core-resolved data and host measurement', async t => {
  const { runtime } = await setup(t);
  runtime.registerMeasurement('Badge', (_type, node) => ({ width: node.label.length * 20, height: 60 }));
  const session = runtime.createSession();
  session.render([
    { version: 'v0.9', createSurface: { surfaceId: 'custom', catalogId: 'custom' } },
    { version: 'v0.9', updateDataModel: { surfaceId: 'custom', path: '/', value: { name: 'Ready' } } },
    { version: 'v0.9', updateComponents: { surfaceId: 'custom', components: [
      { id: 'root', component: 'Badge', label: { path: '/name' } },
    ] } },
  ].map(JSON.stringify).join('\n'));
  await until(() => node(session, 'root', 'custom'), 'custom node');
  assert.equal(node(session, 'root', 'custom').label, 'Ready');
  assert.equal(node(session, 'root', 'custom').styles.height, 60);
});
test('shared theme changes trigger new core-resolved styles', async t => {
  const { runtime, session } = await setup(t);
  const original = node(session, 'heading').styles.color;
  runtime.setTheme('dark');
  await until(() => node(session, 'heading').styles.color !== original, 'dark theme');
  runtime.setTheme('light');
  await until(() => node(session, 'heading').styles.color === original, 'light theme');
});
