import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVaryloom, Varyloom } from '../index';
import type { TransitionEffect, TransitionEffectContext, VaryloomOptions } from '../types';

class FakeElement extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent?: FakeElement;
  addEventListener = vi.fn(super.addEventListener.bind(this));
  removeEventListener = vi.fn(super.removeEventListener.bind(this));
  setAttribute = vi.fn();
  getBoundingClientRect = () => ({ width: 640, height: 480 });
  appendChild(child: FakeElement) {
    child.remove();
    this.children.push(child);
    child.parent = this;
  }
  replaceChildren(...children: FakeElement[]) {
    this.children.forEach((child) => { child.parent = undefined; });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
}

class FakeBitmap {
  width = 640;
  height = 480;
  close = vi.fn();
}

function setup() {
  const container = new FakeElement();
  const canvas = new FakeElement();
  const effect = {
    canvas: canvas as unknown as HTMLCanvasElement,
    init: vi.fn((context: TransitionEffectContext) => {
      (context.host as unknown as FakeElement).appendChild(canvas);
    }),
    prepare: vi.fn(),
    resize: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(() => canvas.remove()),
  } satisfies TransitionEffect;
  const definition = { name: 'test', backend: 'custom' as const, create: vi.fn(() => effect) };
  const options: VaryloomOptions = {
    items: [{ image: new Blob() }, { image: new Blob() }],
    effect: 'test',
    registry: { get: () => definition, list: () => [definition] },
    autoplay: true,
  };
  return { container, element: container as unknown as HTMLElement, effect, options };
}

describe('initialization resource cleanup', () => {
  const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const bitmaps: FakeBitmap[] = [];

  beforeEach(() => {
    observers.length = 0;
    bitmaps.length = 0;
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLImageElement', class {});
    vi.stubGlobal('ImageBitmap', FakeBitmap);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      const bitmap = new FakeBitmap();
      bitmaps.push(bitmap);
      return bitmap;
    }));
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor() { observers.push(this); }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['init', 'prepare'] as const)('factory cleans up when effect %s fails', async (phase) => {
    const { container, element, effect, options } = setup();
    const failure = new Error(`${phase} failed`);
    effect[phase].mockImplementation(() => { throw failure; });

    const ready = createVaryloom(element, options);
    const host = container.children[0];
    await expect(ready).rejects.toBe(failure);

    expect(container.children).toHaveLength(0);
    expect(host.removeEventListener).toHaveBeenCalledTimes(7);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(effect.destroy).toHaveBeenCalledOnce();
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(window.setTimeout).not.toHaveBeenCalled();
  });

  it('cleans up after image loading fails and preserves the original error', async () => {
    const { container, element, effect, options } = setup();
    const failure = new Error('image decoding failed');
    vi.mocked(createImageBitmap).mockRejectedValueOnce(failure);
    const controller = new Varyloom(element, options);
    const onError = vi.fn(() => { throw new Error('consumer listener failed'); });
    controller.on('error', onError);

    await expect(controller.ready).rejects.toBe(failure);

    expect(onError).toHaveBeenCalledWith({ error: failure });
    expect(container.children).toHaveLength(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(effect.init).not.toHaveBeenCalled();
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    controller.destroy();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('cleans up loaded images when the requested effect does not exist', async () => {
    const { container, element, effect, options } = setup();
    options.registry = { get: () => undefined, list: () => [] };

    await expect(createVaryloom(element, options)).rejects.toThrow('Unknown Varyloom transition: "test".');

    expect(container.children).toHaveLength(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(effect.init).not.toHaveBeenCalled();
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('does not resurrect rendering or autoplay when destroyed while decoding images', async () => {
    const { container, element, effect, options } = setup();
    const finish: Array<() => void> = [];
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise((resolve) => {
      const bitmap = new FakeBitmap();
      bitmaps.push(bitmap);
      finish.push(() => resolve(bitmap as unknown as ImageBitmap));
    }));
    const controller = new Varyloom(element, options);
    const onReady = vi.fn();
    controller.on('ready', onReady);

    controller.destroy();
    finish.forEach((resolve) => resolve());
    await controller.ready;

    expect(container.children).toHaveLength(0);
    expect(effect.init).not.toHaveBeenCalled();
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(window.setTimeout).not.toHaveBeenCalled();
  });

  it('disposes a pending effect and never starts a frame after destroy', async () => {
    const { container, element, effect, options } = setup();
    let finish!: () => void;
    effect.init.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const controller = new Varyloom(element, options);
    await vi.waitFor(() => expect(effect.init).toHaveBeenCalledOnce());

    controller.destroy();
    finish();
    await controller.ready;

    expect(effect.destroy).toHaveBeenCalledOnce();
    expect(container.children).toHaveLength(0);
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(window.setTimeout).not.toHaveBeenCalled();
  });

  it('still releases assets, host and listeners when a custom effect destroy throws', async () => {
    const { container, element, effect, options } = setup();
    const controller = await createVaryloom(element, options);
    const failure = new Error('custom cleanup failed');
    effect.destroy.mockImplementation(() => { throw failure; });
    const onDestroy = vi.fn();
    controller.on('destroy', onDestroy);

    expect(() => controller.destroy()).toThrow(failure);

    expect(container.children).toHaveLength(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(() => controller.destroy()).not.toThrow();
    expect(onDestroy).toHaveBeenCalledOnce();
  });
});
