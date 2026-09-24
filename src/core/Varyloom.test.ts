import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Varyloom } from './Varyloom';
import type { TransitionDefinition, TransitionEffect, TransitionEffectContext } from '../types';

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent?: FakeElement;
  tabIndex = 0;

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    this.children.push(child);
    child.parent = this;
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.forEach((child) => { child.parent = undefined; });
    this.children.length = 0;
    children.forEach((child) => this.appendChild(child));
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index, 1);
    this.parent = undefined;
  }
}

function makeEffect() {
  const canvas = new FakeElement();
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    init: vi.fn((context: TransitionEffectContext) => {
      (context.host as unknown as FakeElement).appendChild(canvas);
    }),
    prepare: vi.fn(),
    resize: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(() => canvas.remove()),
  } satisfies TransitionEffect;
}

function makeController(nextEffect: ReturnType<typeof makeEffect>) {
  const host = new FakeElement();
  const oldEffect = makeEffect();
  host.appendChild(oldEffect.canvas as unknown as FakeElement);
  const definitions = new Map<string, TransitionDefinition>([
    ['old', { name: 'old', backend: 'custom', create: () => oldEffect }],
    ['new', { name: 'new', backend: 'custom', create: () => nextEffect }],
  ]);
  const controller = Object.assign(Object.create(Varyloom.prototype), {
    ready: Promise.resolve(),
    container: { getBoundingClientRect: () => ({ width: 640, height: 480 }) },
    host,
    registry: { get: (name: string) => definitions.get(name) },
    options: {
      items: [{ image: 'first' }, { image: 'second' }],
      effect: 'old',
      effectOptions: { oldOption: true },
      autoplay: false,
      autoplayDelay: 4,
      dpr: 2,
      draggable: true,
      keyboard: true,
    },
    images: [],
    activeEffect: oldEffect,
    activeDefinition: definitions.get('old'),
    activeEffectName: 'old',
    requestedEffectName: 'old',
    _currentIndex: 0,
    targetIndex: 0,
    pendingIndex: null,
    motion: { value: 1 },
    transitionActive: false,
    preparing: false,
    destroyed: false,
    dirty: false,
    paused: false,
    hovering: false,
    effectGeneration: 0,
    listeners: new Map(),
  }) as Varyloom;
  return { controller, host, oldEffect };
}

describe('Varyloom effect switching', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
    vi.stubGlobal('devicePixelRatio', 1);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['init', 'prepare'] as const)('keeps the active effect when %s fails', async (phase) => {
    const nextEffect = makeEffect();
    const failure = new Error(`${phase} failed`);
    nextEffect[phase].mockImplementation(() => { throw failure; });
    const { controller, host, oldEffect } = makeController(nextEffect);

    await expect(controller.setEffect('new')).rejects.toBe(failure);

    expect(controller.effect).toBe('old');
    expect(oldEffect.destroy).not.toHaveBeenCalled();
    expect(nextEffect.destroy).toHaveBeenCalledOnce();
    expect(host.children).toEqual([oldEffect.canvas]);
  });

  it('replaces the old effect only after preparation succeeds', async () => {
    const nextEffect = makeEffect();
    let finishPrepare!: () => void;
    nextEffect.prepare.mockImplementation(() => new Promise<void>((resolve) => { finishPrepare = resolve; }));
    const { controller, host, oldEffect } = makeController(nextEffect);

    const switching = controller.setEffect('new');
    await vi.waitFor(() => expect(nextEffect.prepare).toHaveBeenCalledOnce());
    expect(oldEffect.destroy).not.toHaveBeenCalled();
    expect(host.children).toContain(oldEffect.canvas);

    finishPrepare();
    await switching;
    expect(controller.effect).toBe('new');
    expect(oldEffect.destroy).toHaveBeenCalledOnce();
    expect(host.children).toHaveLength(1);
    expect(host.children[0].children).toEqual([nextEffect.canvas]);
  });

  it('reports setOptions effect failures through the error event', async () => {
    const nextEffect = makeEffect();
    const failure = new Error('prepare failed');
    nextEffect.prepare.mockImplementation(() => { throw failure; });
    const { controller, host, oldEffect } = makeController(nextEffect);
    const onError = vi.fn();
    controller.on('error', onError);

    controller.setOptions({ effect: 'new', effectOptions: { nextOption: true } });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith({ error: failure }));

    expect(controller.effect).toBe('old');
    expect(oldEffect.destroy).not.toHaveBeenCalled();
    expect(host.children).toEqual([oldEffect.canvas]);
  });
});
