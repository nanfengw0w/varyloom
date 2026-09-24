// Exercise the actual component source with deterministic hook and controller
// doubles. This verifies ownership/races, not React DOM or GPU rendering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../components/transition-stage.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

const cells = [];
let cursor = 0;
let pending = [];
let dirty = false;
let deferredReady = false;
let rejectNextInitialization = false;
let props;
let published = null;
let status;
const attachedMounts = new Set();
const container = {
  querySelector: () => null,
  querySelectorAll: () => [],
  appendChild: mount => { attachedMounts.add(mount); mount.attached = true; },
};
const documentListeners = new Map();
const document = {
  hidden: false,
  addEventListener: (name, listener) => documentListeners.set(name, listener),
  removeEventListener: name => documentListeners.delete(name),
  createElement: () => {
    const mount = { style: {}, dataset: {}, attached: false, remove() { this.attached = false; attachedMounts.delete(this); } };
    return mount;
  },
};
const intersectionObservers = new Set();
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe() { intersectionObservers.add(this); }
  disconnect() { intersectionObservers.delete(this); }
}
const controllers = [];
class FakeVaryloom {
  constructor(host, options) {
    assert.ok(attachedMounts.has(host));
    this.host = host;
    this.options = options;
    this.effect = options.effect;
    this.currentIndex = options.startIndex;
    this.listeners = new Map();
    this.destroyed = false;
    this.rafRunning = false;
    this.assetsLoaded = false;
    this.assetsReleased = false;
    this.nextCalls = 0;
    const initialization = rejectNextInitialization
      ? Promise.reject(new Error('Simulated unsupported GPU'))
      : deferredReady ? new Promise(resolve => { this.resolveReady = resolve; }) : Promise.resolve();
    // Model published 0.1.0 accurately: initialization can allocate resources
    // and start a RAF after destroy(), whose second call is a no-op.
    this.ready = initialization.then(() => { this.assetsLoaded = true; this.rafRunning = true; });
    rejectNextInitialization = false;
    controllers.push(this);
  }
  on(name, listener) { this.listeners.set(name, listener); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rafRunning = false;
    this.assetsReleased = this.assetsLoaded;
    this.listeners.clear();
  }
  setOptions(options) {
    assert.equal(this.destroyed, false, 'cannot update a destroyed controller');
    this.options = { ...this.options, ...options };
  }
  async setEffect(effect, options) {
    assert.equal(this.destroyed, false, 'cannot remount a destroyed controller');
    this.effect = effect;
    this.options.effectOptions = options;
  }
  play() { assert.equal(this.destroyed, false, 'cannot play a destroyed controller'); }
  next() {
    assert.equal(this.destroyed, false, 'cannot advance a destroyed controller');
    this.nextCalls++;
    this.currentIndex = (this.currentIndex + 1) % 4;
    this.listeners.get('indexchange')?.({ index: this.currentIndex });
  }
}

const hooks = {
  useRef(value) {
    const i = cursor++;
    return cells[i] ?? (cells[i] = { current: value });
  },
  useState(initial) {
    const i = cursor++;
    if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
    return [cells[i], next => {
      const value = typeof next === 'function' ? next(cells[i]) : next;
      if (!Object.is(value, cells[i])) { cells[i] = value; dirty = true; }
    }];
  },
  useEffect(callback, dependencies) {
    const i = cursor++;
    const previous = cells[i];
    if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
      pending.push(() => {
        previous?.cleanup?.();
        cells[i] = { dependencies, cleanup: callback() };
      });
    }
  },
};
const jsx = (type, attributes) => {
  if (attributes?.className === 'transition-host') attributes.ref.current = container;
  return { type, props: attributes };
};
const sandbox = {
  exports: {},
  require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'varyloom') return { Varyloom: FakeVaryloom };
    if (name === '@/lib/catalog') return {
      photographs: Array.from({ length: 4 }, (_, index) => ({
        file: `image${index}.jpg`, alt: { en: `Image ${index}`, zh: `Image ${index}` },
      })),
    };
    if (name === '@/lib/site-path') return { sitePath: path => '/varyloom' + path };
    throw new Error(`Unexpected component dependency: ${name}`);
  },
  document,
  IntersectionObserver: FakeIntersectionObserver,
  MutationObserver: class { observe() {} disconnect() {} },
  console: { ...console, warn: () => {} },
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(compiled, sandbox, { filename: 'transition-stage.test-runtime.cjs' });
const Component = sandbox.exports.default;
props = {
  effect: { id: 'meteor-wake' }, options: { imageFit: 'cover', particleCount: 8192 },
  duration: 3, easing: 'none', autoplay: true, visible: true, lang: 'en', index: 2,
  onIndex: index => { props = { ...props, index }; dirty = true; },
  onController: value => { published = value; },
  onStatus: value => { status = value; },
};
function render() {
  cursor = 0;
  dirty = false;
  Component(props);
  const jobs = pending;
  pending = [];
  jobs.forEach(callback => callback());
}
async function settle() {
  for (let index = 0; index < 16; index++) {
    await Promise.resolve();
    if (dirty) render();
  }
}
async function update(values) { props = { ...props, ...values }; render(); await settle(); }
async function intersection(isIntersecting) {
  intersectionObservers.forEach(observer => observer.callback([{ isIntersecting }]));
  await settle();
}
async function pageVisibility(hidden) {
  document.hidden = hidden;
  documentListeners.get('visibilitychange')();
  await settle();
}
const live = () => controllers.filter(controller => !controller.destroyed);
const running = () => controllers.filter(controller => controller.rafRunning);

render();
await settle();
assert.equal(controllers.length, 0, 'offscreen stage must not allocate a GPU controller');
await intersection(true);
assert.equal(live().length, 1);
assert.equal(published.currentIndex, 2);
assert.equal(published.options.items[0].image, '/varyloom/images/image0.jpg');
assert.equal(published.nextCalls, 0);
published.next();
await settle();
assert.equal(props.index, 3);

await intersection(false);
assert.equal(live().length, 0, 'scrolling away must release continuous effects');
assert.equal(published, null);
await intersection(true);
assert.equal(live().length, 1);
assert.equal(published.currentIndex, 3);
assert.equal(published.nextCalls, 0, 'returning must not skip the saved image');

await update({ visible: false });
await intersection(false);
assert.equal(live().length, 0, 'Code tab must release the preview');
await update({ visible: true });
assert.equal(live().length, 0, 'wait for the displayed preview to intersect again');
await intersection(true);
assert.equal(live().length, 1);
assert.equal(published.currentIndex, 3);

await pageVisibility(true);
assert.equal(live().length, 0, 'background browser tab must release continuous effects');
assert.equal(published, null);
await pageVisibility(false);
assert.equal(live().length, 1);
assert.equal(published.currentIndex, 3);

await update({ visible: false });
deferredReady = true;
await update({ visible: true });
const cancelled = controllers.at(-1);
assert.equal(published, null);
await update({ visible: false });
assert.equal(cancelled.host.attached, false, 'pending preview detaches immediately');
assert.equal(cancelled.destroyed, false, 'defer the one effective destroy until initialization settles');
cancelled.resolveReady();
await settle();
assert.equal(live().length, 0);
assert.equal(running().length, 0, 'late initialization RAF must be cancelled');
assert.equal(cancelled.assetsReleased, true, 'images loaded after hiding must be released');
assert.equal(published, null, 'cancelled initialization cannot publish an obsolete controller');

deferredReady = false;
await update({ effect: { id: 'particle-shift' }, visible: true });
assert.equal(live().length, 1);
assert.equal(published.effect, 'particle-shift');
await update({ effect: { id: 'memory-mosaic' } });
assert.equal(live().length, 1);
assert.equal(published.effect, 'memory-mosaic');
assert.equal(status, 'ready');
await update({ options: { imageFit: 'contain', particleCount: 16384 } });
await new Promise(resolve => setTimeout(resolve, 210));
await settle();
assert.equal(published.options.effectOptions.imageFit, 'contain');
assert.equal(status, 'ready');

deferredReady = true;
await update({ effect: { id: 'meteor-wake' } });
const obsolete = controllers.at(-1);
await update({ effect: { id: 'particle-shift' } });
const replacement = controllers.at(-1);
assert.equal(obsolete.host.attached, false);
assert.equal(attachedMounts.size, 1);
replacement.resolveReady();
await settle();
assert.equal(published, replacement);
obsolete.resolveReady();
await settle();
assert.equal(published, replacement, 'late old readiness cannot replace the newer effect');
assert.equal(obsolete.assetsReleased, true);
assert.equal(obsolete.rafRunning, false);
assert.equal(running().length, 1);
assert.equal(live().length, 1);
deferredReady = false;

rejectNextInitialization = true;
await update({ effect: { id: 'meteor-wake' } });
assert.equal(live().length, 1, 'failed requested effect must be released before fallback');
assert.equal(published.effect, 'melt');
await intersection(false);
assert.equal(live().length, 0, 'continuous fallback must also be released offscreen');
await intersection(true);
assert.equal(live().length, 1);
cells.forEach(cell => cell?.cleanup?.());
await settle();
assert.equal(live().length, 0, 'unmount must release its last controller');
assert.equal(running().length, 0);
assert.equal(attachedMounts.size, 0);
assert.equal(documentListeners.size, 0);
assert.equal(intersectionObservers.size, 0);

console.log('PASS: offscreen allocation, viewport resume, Code tab, page visibility, stale initialization, effect switch, live parameters, fallback cleanup, unmount, and Pages image paths.');
