// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
// A reference DOM adapter. The C++ core owns bindings, diffs and Yoga layout.
const SCALE = 2;
const activeRenderers = new WeakSet();
const noop = () => {};
const scalarText = value => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
const pixels = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value / SCALE;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?px$/.test(value)) return parseFloat(value) / SCALE;
  return undefined;
};
const dimensionStyles = ['font-size', 'line-height', 'border-width', 'border-radius', 'letter-spacing'];
const colorStyles = ['color', 'background-color', 'border-color'];

function paint(element, node, layout) {
  const styles = node.styles ?? {};
  for (const key of dimensionStyles) {
    const value = pixels(styles[key]);
    element.style.setProperty(key, value === undefined ? '' : `${Math.max(0, value)}px`);
  }
  for (const key of colorStyles) {
    const value = styles[key];
    element.style.setProperty(key, typeof value === 'string' && CSS.supports(key, value) ? value : '');
  }
  element.style.borderStyle = ['solid', 'dashed', 'dotted', 'none'].includes(styles['border-style']) ? styles['border-style'] : '';
  element.style.fontWeight = /^(normal|bold|[1-9]00)$/.test(String(styles['font-weight'])) ? styles['font-weight'] : '';
  element.style.textAlign = ['left', 'right', 'center', 'justify'].includes(styles['text-align']) ? styles['text-align'] : '';
  element.style.opacity = typeof styles.opacity === 'number' ? String(Math.max(0, Math.min(1, styles.opacity))) : '';
  element.hidden = styles.visibility === 'hidden' || styles.display === 'none';
  const label = node.accessibility?.label;
  if (typeof label === 'string') element.setAttribute('aria-label', label);
  else element.removeAttribute('aria-label');
  if (!layout) return;
  for (const [key, source] of [['left', 'x'], ['top', 'y'], ['width', 'width'], ['height', 'height']]) {
    const value = pixels(styles[source]);
    element.style[key] = `${['width', 'height'].includes(key) ? Math.max(0, value ?? 0) : value ?? 0}px`;
  }
}

function builtin(type) {
  return ({ document, change, action }) => {
    const element = document.createElement(type === 'Button' ? 'button' : type === 'Text' || type === 'Icon' ? 'span' : 'div');
    element.className = `agenui-node agenui-${type.toLowerCase()}`;
    let input, caption, output;
    const container = ['Column', 'Row', 'Card', 'List', 'Button'].includes(type);
    if (type === 'Button') { element.type = 'button'; element.addEventListener('click', action); }
    if (type === 'Divider') element.setAttribute('role', 'separator');
    if (['TextField', 'CheckBox', 'Slider'].includes(type)) {
      caption = document.createElement('label');
      const text = document.createElement('span');
      input = document.createElement('input');
      input.type = type === 'CheckBox' ? 'checkbox' : type === 'Slider' ? 'range' : 'text';
      input.autocomplete = 'off';
      input.addEventListener('input', () => change({ value: type === 'CheckBox' ? input.checked : type === 'Slider' ? input.valueAsNumber : input.value }));
      caption.className = 'agenui-label';
      caption.append(text, input);
      element.append(caption);
      if (type === 'Slider') { output = document.createElement('output'); caption.append(output); }
    }
    return {
      element,
      childrenElement: container ? element : undefined,
      update(node) {
        if (type === 'Text') {
          element.textContent = scalarText(node.text);
          const heading = /^h[1-6]$/.test(node.variant ?? '');
          if (heading) { element.setAttribute('role', 'heading'); element.setAttribute('aria-level', node.variant.slice(1)); }
          else { element.removeAttribute('role'); element.removeAttribute('aria-level'); }
        }
        if (type === 'Icon') element.textContent = scalarText(node.name);
        if (input) {
          caption.firstChild.textContent = scalarText(node.label);
          input.setAttribute('aria-label', scalarText(node.label));
          input.disabled = node.disabled === true;
          if (type === 'CheckBox') input.checked = node.value === true;
          else {
            if (type === 'Slider') {
              input.min = String(node.min ?? 0); input.max = String(node.max ?? 100); input.step = String(node.step ?? 1);
              output.value = scalarText(node.value);
            }
            const value = scalarText(node.value);
            // Avoid replacing a focused input's selection on unrelated updates.
            if (input.value !== value) input.value = value;
          }
        }
        if (type === 'Button') element.disabled = node.disabled === true;
      },
    };
  };
}
export const defaultComponents = Object.freeze(Object.fromEntries(
  ['Column', 'Row', 'Card', 'List', 'Text', 'Icon', 'Divider', 'Button', 'TextField', 'CheckBox', 'Slider'].map(type => [type, builtin(type)]),
));

/** Create a DOM renderer backed by a Wasm session. Import styles.css once. */
export function createDOMRenderer(runtime, container, options = {}) {
  if (activeRenderers.has(runtime)) throw new Error('Use a separate runtime for each DOM renderer');
  const document = container.ownerDocument;
  const components = Object.assign(Object.create(null), defaultComponents, options.components);
  const frames = new Map();
  let disposed = false;
  let scheduled = false;
  const onError = options.onError ?? console.error;
  const measurement = document.createElement('div');
  measurement.className = 'agenui-measurement';
  measurement.setAttribute('aria-hidden', 'true');
  measurement.inert = true;
  document.body.append(measurement);

  for (const [type, factory] of Object.entries(components)) {
    runtime.registerMeasurement(type, (_type, node, bounds) => {
      if (disposed) return { width: 0, height: 0 };
      if (options.measure?.[type]) return options.measure[type](node, bounds);
      const view = factory({ document, change: noop, action: noop, measuring: true });
      try {
        view.update(node); paint(view.element, node, false);
        view.element.classList.add('agenui-measuring');
        const available = Number.isFinite(bounds.width) ? bounds.width / SCALE : 10000;
        if (bounds.widthMode === 1) view.element.style.width = `${available}px`;
        if (bounds.widthMode === 2) view.element.style.maxWidth = `${available}px`;
        measurement.append(view.element);
        const rect = view.element.getBoundingClientRect();
        const constrain = (size, limit, mode) => mode === 1 ? limit : mode === 2 ? Math.min(size, limit) : size;
        return {
          width: constrain(rect.width * SCALE, bounds.width, bounds.widthMode),
          height: constrain(rect.height * SCALE, bounds.height, bounds.heightMode),
        };
      } finally { view.dispose?.(); view.element.remove(); }
    });
  }
  const size = () => ({ width: Math.max(1, container.clientWidth) * SCALE, height: (options.height ?? 800) * SCALE });
  const session = runtime.createSession({ ...size(), onError, onEvent(event) {
    try {
      if (event.type === 'action') options.onAction?.(event.value);
      if (event.type === 'error') onError(new Error(event.message));
      options.onEvent?.(event);
    } finally { schedule(); }
  } });
  activeRenderers.add(runtime);
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed) { try { draw(); } catch (error) { onError(error); } } });
  }
  function removeFrame(frame) {
    for (const view of frame.views.values()) view.dispose?.();
    frame.element.remove();
  }
  function draw() {
    for (const [id, frame] of frames) if (!session.surfaces.has(id)) { removeFrame(frame); frames.delete(id); }
    for (const [surfaceId, nodes] of session.surfaces) {
      if (!frames.has(surfaceId)) {
        const element = document.createElement('div');
        element.className = 'agenui-surface'; element.dataset.surfaceId = surfaceId;
        container.append(element); frames.set(surfaceId, { element, views: new Map() });
      }
      const frame = frames.get(surfaceId);
      for (const [id, view] of frame.views) if (!nodes.has(id)) { view.dispose?.(); view.element.remove(); frame.views.delete(id); }
      for (const [id, node] of nodes) {
        let view = frame.views.get(id);
        if (view && view.type !== node.component) { view.dispose?.(); view.element.remove(); frame.views.delete(id); view = undefined; }
        if (!view) {
          const factory = components[node.component];
          if (factory) {
            view = factory({ document, measuring: false,
              change: values => { if (!disposed) session.change(surfaceId, id, values); },
              action: () => { if (!disposed) session.action(surfaceId, id); },
            });
          } else {
            const element = document.createElement('div');
            element.className = 'agenui-node agenui-unsupported'; element.setAttribute('role', 'status');
            element.textContent = `Unsupported component: ${node.component}`;
            view = { element, update: noop };
            onError(new Error(`No Web component registered for ${node.component}`));
          }
          view.type = node.component; view.element.dataset.componentId = id; frame.views.set(id, view);
        }
        view.update(node); paint(view.element, node, true);
      }
      // Reconcile parentage and ordering without remounting controls on each diff.
      const root = frame.views.get('root');
      if (root && root.element.parentNode !== frame.element) frame.element.append(root.element);
      for (const [id, node] of nodes) {
        const host = frame.views.get(id)?.childrenElement;
        if (!host) continue;
        const childIds = node.children ?? (node.child ? [node.child] : []);
        let cursor = host.firstElementChild;
        for (const childId of childIds) {
          const child = frame.views.get(childId)?.element;
          if (!child) continue;
          if (child === cursor) cursor = cursor.nextElementSibling;
          else host.insertBefore(child, cursor);
        }
      }
      const rootStyle = nodes.get('root')?.styles ?? {};
      frame.element.style.height = `${Math.max(0, (pixels(rootStyle.height) ?? 0) + (pixels(rootStyle.y) ?? 0))}px`;
    }
  }
  const observer = new ResizeObserver(() => {
    if (disposed) return;
    const { width, height } = size();
    for (const id of session.surfaces.keys()) session.resize(id, width, height);
  });
  observer.observe(container);
  return {
    session,
    render: text => session.render(text),
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect(); session.dispose(); measurement.remove();
      activeRenderers.delete(runtime);
      for (const frame of frames.values()) removeFrame(frame);
      frames.clear();
    },
  };
}
