// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
import createModule from './agenui.mjs';

const ownEntries = value => Object.entries(value ?? {}).filter(([key]) =>
  !['__proto__', 'constructor', 'prototype'].includes(key));
function reportError(handler, error) {
  try { (handler ?? console.error)(error); } catch (reportingError) { console.error(reportingError); }
}

/** Apply the core's top-level property diff. Null means removal, not a value. */
export function applyPatch(previous, patch) {
  const next = Object.assign(Object.create(null), previous);
  for (const [key, value] of ownEntries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (typeof patch.textChunk === 'string') next.text = (previous.text ?? '') + patch.textChunk;
  return next;
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value > 100000) throw new RangeError(`Invalid ${name}`);
  return value;
}

/** Each runtime owns an isolated instance of the real C++/Yoga Wasm module. */
export async function createRuntime(options = {}) {
  const module = await createModule({
    ...(options.wasmURL ? { locateFile: () => String(options.wasmURL) } : {}),
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    print: () => {},
  });
  module.initialize();
  const sessions = new Set();
  let disposed = false;
  const check = () => { if (disposed) throw new Error('AGenUI runtime is disposed'); };
  const runtime = {
    version: module.version(),
    registerMeasurement(type, measure) {
      check();
      module.registerMeasurement(type, (name, json, width, widthMode, height, heightMode) => {
        // Measurements and layout use A2UI units: two units per CSS pixel.
        try {
          const size = measure(name, JSON.parse(json), { width, widthMode, height, heightMode });
          return { width: Math.max(0, Number(size.width) || 0), height: Math.max(0, Number(size.height) || 0) };
        } catch (error) {
          queueMicrotask(() => reportError(options.onError, error));
          return { width: 0, height: 0 };
        }
      });
    },
    setTheme(mode) {
      check();
      if (!['light', 'dark'].includes(mode)) throw new TypeError('Theme must be light or dark');
      module.setTheme(mode);
      for (const session of sessions) session.invalidate();
    },
    loadTheme(value) { check(); const error = module.loadTheme(JSON.stringify(value)); if (error) throw new Error(error); },
    loadTokens(value) { check(); const error = module.loadTokens(JSON.stringify(value)); if (error) throw new Error(error); },
    createSession({ width = 800, height = 1200, onEvent, onError } = {}) {
      check();
      positive(width, 'width'); positive(height, 'height');
      const surfaces = new Map();
      const listeners = new Set();
      if (onEvent) listeners.add(onEvent);
      let closed = false;
      let received = 0;
      const report = error => reportError(onError ?? options.onError, error);
      const native = new module.NativeSurface(json => {
        // Defer host calls until the engine has released its internal locks.
        queueMicrotask(() => {
          if (closed) return;
          try {
            const event = JSON.parse(json);
            if (event.type === 'create') surfaces.set(event.surfaceId, new Map());
            if (event.type === 'delete') surfaces.delete(event.surfaceId);
            const nodes = surfaces.get(event.surfaceId);
            if (nodes && (event.type === 'add' || event.type === 'update')) {
              for (const item of event.items) {
                const previous = nodes.get(item.id) ?? { id: item.id };
                nodes.set(item.id, applyPatch(previous, {
                  ...item.value, ...(event.type === 'add' ? { parentId: item.parentId } : {}),
                }));
              }
            }
            if (nodes && event.type === 'remove') {
              const remove = id => {
                for (const [childId, child] of nodes) if (child.parentId === id) remove(childId);
                nodes.delete(id);
              };
              for (const item of event.items) remove(item.id);
            }
            for (const listener of [...listeners]) {
              try { listener(event); } catch (error) { report(error); }
            }
          } catch (error) { report(error); }
        });
      }, width, height);
      const active = () => { check(); if (closed) throw new Error('AGenUI session is disposed'); };
      const session = {
        surfaces,
        subscribe(listener) { active(); listeners.add(listener); return () => listeners.delete(listener); },
        begin() { active(); received = 0; native.begin(); },
        push(chunk) {
          active();
          if (typeof chunk !== 'string') throw new TypeError('Expected a decoded text chunk');
          received += chunk.length;
          if (received > 1048576) throw new RangeError('A stream is limited to 1,048,576 UTF-16 code units; begin a new stream');
          native.push(chunk);
        },
        end() { active(); native.end(); },
        render(document) { this.begin(); this.push(document); this.end(); },
        resize(surfaceId, width, height) {
          active(); native.resize(surfaceId, positive(width, 'width'), positive(height, 'height'));
        },
        change(surfaceId, componentId, values) { active(); native.change(surfaceId, componentId, JSON.stringify(values)); },
        action(surfaceId, componentId, context = {}) { active(); native.action(surfaceId, componentId, JSON.stringify(context)); },
        invalidate() { active(); native.invalidate(); },
        dispose() {
          if (closed) return;
          closed = true;
          listeners.clear(); surfaces.clear();
          native.delete(); sessions.delete(session);
        },
      };
      sessions.add(session);
      return session;
    },
    dispose() {
      if (disposed) return;
      for (const session of [...sessions]) session.dispose();
      module.shutdown();
      disposed = true;
    },
  };
  return runtime;
}
