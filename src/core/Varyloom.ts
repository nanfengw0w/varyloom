import { gsap } from 'gsap';

import { loadItems } from './assets';
import { transitionRegistry } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomController,
  VaryloomEventListener,
  VaryloomEventMap,
  VaryloomEventName,
  VaryloomOptions,
  ResolvedVaryloomOptions,
  TransitionDefinition,
  TransitionEffect,
  TransitionName,
  TransitionRegistryLike,
} from '../types';

const DEFAULT_OPTIONS = {
  effect: 'ink-reveal',
  duration: 1.2,
  easing: 'power2.inOut',
  startIndex: 0,
  autoplay: false,
  autoplayDelay: 4,
  loop: true,
  draggable: true,
  keyboard: true,
  pauseOnHover: true,
  preload: 'all',
  crossOrigin: 'anonymous',
  dpr: 2,
  fallbackEffect: 'melt',
  effectOptions: {},
} satisfies Omit<ResolvedVaryloomOptions, 'items'>;

type ListenerMap = Map<VaryloomEventName, Set<(payload: unknown) => void>>;

export class Varyloom<TData = unknown> implements VaryloomController<TData> {
  readonly ready: Promise<void>;

  private readonly container: HTMLElement;
  private readonly host: HTMLDivElement;
  private readonly registry: TransitionRegistryLike;
  private options: ResolvedVaryloomOptions<TData>;
  private images: Array<LoadedImage<TData>> = [];
  private activeEffect?: TransitionEffect<TData>;
  private activeDefinition?: TransitionDefinition<TData>;
  private activeEffectName: TransitionName;
  private requestedEffectName: TransitionName;
  private _currentIndex = 0;
  private targetIndex = 0;
  private pendingIndex: number | null = null;
  private direction: Direction = 1;
  private motion = { value: 1 };
  private tween?: gsap.core.Tween;
  private transitionActive = false;
  private preparing = false;
  private destroyed = false;
  private paused = false;
  private hovering = false;
  private dirty = true;
  private rendering = false;
  private frameId = 0;
  private previousTime = performance.now();
  private startTime = performance.now();
  private autoplayTimer?: number;
  private resizeObserver: ResizeObserver;
  private effectGeneration = 0;
  private pointer = { x: 0.5, y: 0.5 };
  private drag = { active: false, startX: 0, width: 1, direction: 1 as Direction };
  private listeners: ListenerMap = new Map();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(container: HTMLElement, options: VaryloomOptions<TData>) {
    if (!(container instanceof HTMLElement)) throw new TypeError('Varyloom requires an HTMLElement container.');
    if (!Array.isArray(options.items) || options.items.length < 2) {
      throw new Error('Varyloom requires at least two image items.');
    }

    this.container = container;
    this.registry = options.registry ?? transitionRegistry;
    this.options = this.resolveOptions(options);
    this.activeEffectName = this.options.effect;
    this.requestedEffectName = this.options.effect;
    this._currentIndex = this.wrap(this.options.startIndex);
    this.targetIndex = this._currentIndex;

    this.host = document.createElement('div');
    this.host.dataset.varyloom = '';
    Object.assign(this.host.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      minWidth: '1px',
      minHeight: '1px',
      overflow: 'hidden',
      touchAction: this.options.draggable ? 'pan-y' : 'auto',
    });
    this.host.tabIndex = this.options.keyboard ? 0 : -1;
    this.host.setAttribute('role', 'group');
    this.host.setAttribute('aria-roledescription', 'carousel');
    this.container.appendChild(this.host);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.bindInput();
    this.ready = this.initialize();
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get effect(): TransitionName {
    return this.activeEffectName;
  }

  get isTransitioning(): boolean {
    return this.transitionActive || this.preparing;
  }

  private resolveOptions(options: VaryloomOptions<TData>): ResolvedVaryloomOptions<TData> {
    return {
      ...DEFAULT_OPTIONS,
      ...options,
      items: options.items,
      effectOptions: { ...DEFAULT_OPTIONS.effectOptions, ...options.effectOptions },
      dpr: Math.max(1, options.dpr ?? DEFAULT_OPTIONS.dpr),
      duration: Math.max(0, options.duration ?? DEFAULT_OPTIONS.duration),
      autoplayDelay: Math.max(0.1, options.autoplayDelay ?? DEFAULT_OPTIONS.autoplayDelay),
    } as ResolvedVaryloomOptions<TData>;
  }

  private async initialize(): Promise<void> {
    try {
      this.images = await loadItems(this.options.items, this.options.crossOrigin);
      await this.mountEffect(this.options.effect, this.options.effectOptions);
      this.startTime = performance.now();
      this.previousTime = this.startTime;
      this.frameId = requestAnimationFrame((time) => this.tick(time));
      this.scheduleAutoplay();
      this.emit('ready', { effect: this.activeEffectName, index: this._currentIndex });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.emit('error', { error });
      throw error;
    }
  }

  private getSize(): { width: number; height: number; dpr: number } {
    const bounds = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      dpr: Math.min(devicePixelRatio || 1, this.options.dpr),
    };
  }

  private async resolveDefinition(requestedName: TransitionName): Promise<TransitionDefinition<TData>> {
    const requested = this.registry.get(requestedName) as TransitionDefinition<TData> | undefined;
    if (!requested) throw new Error(`Unknown Varyloom transition: "${requestedName}".`);
    if (!requested.supported || await requested.supported()) return requested;

    const fallbackName = this.options.fallbackEffect;
    if (!fallbackName || fallbackName === requestedName) {
      throw new Error(`Transition "${requestedName}" is not supported in this browser.`);
    }
    const fallback = this.registry.get(fallbackName) as TransitionDefinition<TData> | undefined;
    if (!fallback || (fallback.supported && !await fallback.supported())) {
      throw new Error(`Neither "${requestedName}" nor fallback "${fallbackName}" is supported.`);
    }
    this.emit('fallback', { requestedEffect: requestedName, fallbackEffect: fallbackName });
    return fallback;
  }

  private async mountEffect(name: TransitionName, effectOptions: Record<string, unknown>): Promise<void> {
    const generation = ++this.effectGeneration;
    const definition = await this.resolveDefinition(name);
    if (this.destroyed || generation !== this.effectGeneration) return;

    this.tween?.kill();
    this.transitionActive = false;
    this.preparing = false;
    this.activeEffect?.destroy();
    this.host.replaceChildren();

    const effect = definition.create() as TransitionEffect<TData>;
    const size = this.getSize();
    const mergedOptions = { ...definition.defaults, ...effectOptions };
    this.options.effectOptions = mergedOptions;
    await effect.init({
      host: this.host,
      items: this.images,
      ...size,
      options: mergedOptions,
      reportError: (error) => this.emit('error', { error }),
    });
    if (this.destroyed || generation !== this.effectGeneration) {
      effect.destroy();
      return;
    }

    this.activeEffect = effect;
    this.activeDefinition = definition;
    this.activeEffectName = definition.name;
    this.requestedEffectName = name;
    Object.assign(effect.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    });
    effect.resize(size.width, size.height, size.dpr);
    await effect.prepare(this._currentIndex, this._currentIndex, 1);
    this.motion.value = 1;
    this.dirty = true;
    this.emit('effectchange', { effect: definition.name, requestedEffect: name });
  }

  private resize(): void {
    if (!this.activeEffect || this.destroyed) return;
    const size = this.getSize();
    this.activeEffect.resize(size.width, size.height, size.dpr);
    this.dirty = true;
  }

  private tick(timestamp: number): void {
    if (this.destroyed) return;
    const shouldRender = this.dirty || this.transitionActive || Boolean(this.activeEffect?.continuous);

    if (shouldRender && this.activeEffect && !this.rendering) {
      const delta = Math.min(Math.max((timestamp - this.previousTime) / 1000, 1 / 240), 1 / 20);
      this.previousTime = timestamp;
      this.dirty = false;
      const frame = {
        progress: this.motion.value,
        time: (timestamp - this.startTime) / 1000,
        delta,
        duration: this.options.duration,
        direction: this.direction,
        active: this.transitionActive,
        pointer: this.pointer,
        options: this.options.effectOptions,
      } as const;
      const rendered = this.activeEffect.render(frame);
      if (rendered instanceof Promise) {
        this.rendering = true;
        rendered.catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          this.emit('error', { error });
        }).finally(() => {
          this.rendering = false;
          if (this.transitionActive) this.dirty = true;
        });
      }
    }
    this.frameId = requestAnimationFrame((time) => this.tick(time));
  }

  private beginTransition(target: number, direction: Direction, startProgress = 0): void {
    if (!this.activeEffect || this.destroyed) return;
    if (this.isTransitioning) {
      this.pendingIndex = target;
      return;
    }

    this.clearAutoplay();
    this.targetIndex = target;
    this.direction = direction;
    this.motion.value = startProgress;
    this.previousTime = performance.now();
    this.preparing = true;
    Promise.resolve(this.activeEffect.prepare(this._currentIndex, target, direction)).then(() => {
      if (this.destroyed) return;
      this.preparing = false;
      this.transitionActive = true;
      this.emit('transitionstart', { from: this._currentIndex, to: target, direction });
      this.animateProgress(1, startProgress);
    }).catch((cause) => {
      this.preparing = false;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.emit('error', { error });
    });
  }

  private animateProgress(destination: 0 | 1, fromProgress = this.motion.value): void {
    this.tween?.kill();
    const fullDuration = this.reducedMotion ? Math.min(this.options.duration, 0.25) : this.options.duration;
    const distance = Math.abs(destination - fromProgress);
    this.tween = gsap.to(this.motion, {
      value: destination,
      duration: fullDuration * distance,
      ease: this.activeDefinition?.phaseEasing ?? this.options.easing,
      overwrite: true,
      onUpdate: () => {
        this.dirty = true;
        this.emit('progress', {
          from: this._currentIndex,
          to: this.targetIndex,
          progress: this.motion.value,
        });
      },
      onComplete: () => {
        if (destination === 1) this.commitTransition();
        else this.cancelTransition();
      },
    });
  }

  private commitTransition(): void {
    this._currentIndex = this.targetIndex;
    this.transitionActive = false;
    this.motion.value = 1;
    this.dirty = true;
    this.emit('indexchange', {
      index: this._currentIndex,
      item: this.options.items[this._currentIndex],
    });
    this.emit('transitionend', { index: this._currentIndex });

    const pending = this.pendingIndex;
    this.pendingIndex = null;
    if (pending !== null && pending !== this._currentIndex) {
      const direction: Direction = pending > this._currentIndex ? 1 : -1;
      queueMicrotask(() => this.beginTransition(pending, direction));
    } else {
      void this.activeEffect?.prepare(this._currentIndex, this._currentIndex, this.direction);
      this.scheduleAutoplay();
    }
  }

  private cancelTransition(): void {
    this.transitionActive = false;
    this.targetIndex = this._currentIndex;
    this.motion.value = 1;
    void this.activeEffect?.prepare(this._currentIndex, this._currentIndex, this.direction);
    this.dirty = true;
    this.scheduleAutoplay();
  }

  private wrap(index: number): number {
    const count = this.options.items.length;
    return ((index % count) + count) % count;
  }

  private normalizeTarget(index: number): number | null {
    if (this.options.loop) return this.wrap(index);
    if (index < 0 || index >= this.options.items.length) return null;
    return index;
  }

  next(): void {
    const base = this.isTransitioning ? this.targetIndex : this._currentIndex;
    const target = this.normalizeTarget(base + 1);
    if (target !== null) this.beginTransition(target, 1);
  }

  prev(): void {
    const base = this.isTransitioning ? this.targetIndex : this._currentIndex;
    const target = this.normalizeTarget(base - 1);
    if (target !== null) this.beginTransition(target, -1);
  }

  goTo(index: number): void {
    const target = this.normalizeTarget(index);
    if (target === null || target === this._currentIndex && !this.isTransitioning) return;
    const base = this.isTransitioning ? this.targetIndex : this._currentIndex;
    this.beginTransition(target, target >= base ? 1 : -1);
  }

  seek(progress: number): void {
    if (!this.activeEffect || this.destroyed) return;
    const value = Math.min(1, Math.max(0, progress));
    if (!this.transitionActive && !this.preparing) {
      const target = this.normalizeTarget(this._currentIndex + 1);
      if (target === null) return;
      this.targetIndex = target;
      this.direction = 1;
      this.transitionActive = true;
      this.previousTime = performance.now();
      void this.activeEffect.prepare(this._currentIndex, target, 1);
      this.emit('transitionstart', { from: this._currentIndex, to: target, direction: 1 });
    }
    this.tween?.kill();
    this.motion.value = value;
    this.dirty = true;
    if (value >= 1) this.commitTransition();
  }

  play(): void {
    this.paused = false;
    this.scheduleAutoplay();
  }

  pause(): void {
    this.paused = true;
    this.clearAutoplay();
  }

  async setEffect(name: TransitionName, options: Record<string, unknown> = {}): Promise<void> {
    await this.ready;
    await this.mountEffect(name, options);
  }

  setOptions(options: Partial<Omit<VaryloomOptions<TData>, 'items' | 'registry'>>): void {
    const previousEffect = this.requestedEffectName;
    this.options = this.resolveOptions({ ...this.options, ...options, items: this.options.items });
    this.host.style.touchAction = this.options.draggable ? 'pan-y' : 'auto';
    this.host.tabIndex = this.options.keyboard ? 0 : -1;
    if (options.effect && options.effect !== previousEffect) {
      void this.setEffect(options.effect, options.effectOptions ?? {});
    } else if (options.effectOptions) {
      this.options.effectOptions = {
        ...this.activeDefinition?.defaults,
        ...this.options.effectOptions,
        ...options.effectOptions,
      };
      this.dirty = true;
    }
    this.scheduleAutoplay();
  }

  on<TName extends VaryloomEventName>(
    name: TName,
    listener: VaryloomEventListener<TData, TName>,
  ): () => void {
    let listeners = this.listeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(name, listeners);
    }

    const untypedListener = listener as (payload: unknown) => void;
    listeners.add(untypedListener);
    return () => listeners?.delete(untypedListener);
  }

  private emit<TName extends VaryloomEventName>(
    name: TName,
    payload: VaryloomEventMap<TData>[TName],
  ): void {
    const listeners = this.listeners.get(name);
    listeners?.forEach((listener) => listener(payload));
  }

  private scheduleAutoplay(): void {
    this.clearAutoplay();
    if (!this.options.autoplay || this.paused || this.destroyed || this.isTransitioning) return;
    if (this.options.pauseOnHover && this.hovering) return;
    this.autoplayTimer = window.setTimeout(() => this.next(), this.options.autoplayDelay * 1000);
  }

  private clearAutoplay(): void {
    if (this.autoplayTimer !== undefined) window.clearTimeout(this.autoplayTimer);
    this.autoplayTimer = undefined;
  }

  private bindInput(): void {
    this.host.addEventListener('pointerdown', this.handlePointerDown);
    this.host.addEventListener('pointermove', this.handlePointerMove);
    this.host.addEventListener('pointerup', this.handlePointerUp);
    this.host.addEventListener('pointercancel', this.handlePointerUp);
    this.host.addEventListener('keydown', this.handleKeyDown);
    this.host.addEventListener('mouseenter', this.handleMouseEnter);
    this.host.addEventListener('mouseleave', this.handleMouseLeave);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const bounds = this.host.getBoundingClientRect();
    this.pointer = {
      x: (event.clientX - bounds.left) / Math.max(bounds.width, 1),
      y: 1 - (event.clientY - bounds.top) / Math.max(bounds.height, 1),
    };
    if (!this.options.draggable || this.isTransitioning) return;
    this.clearAutoplay();
    this.previousTime = performance.now();
    this.drag = { active: true, startX: event.clientX, width: Math.max(bounds.width, 1), direction: 1 };
    this.host.setPointerCapture?.(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag.active || !this.activeEffect) return;
    const distance = (event.clientX - this.drag.startX) / this.drag.width;
    const direction: Direction = distance < 0 ? 1 : -1;
    const target = this.normalizeTarget(this._currentIndex + direction);
    if (target === null) return;
    if (!this.transitionActive || direction !== this.drag.direction) {
      this.drag.direction = direction;
      this.direction = direction;
      this.targetIndex = target;
      this.transitionActive = true;
      void this.activeEffect.prepare(this._currentIndex, target, direction);
      this.emit('transitionstart', { from: this._currentIndex, to: target, direction });
    }
    this.motion.value = Math.min(1, Math.abs(distance));
    this.dirty = true;
  };

  private handlePointerUp = (): void => {
    if (!this.drag.active) return;
    this.drag.active = false;
    if (!this.transitionActive) {
      this.scheduleAutoplay();
      return;
    }
    this.animateProgress(this.motion.value > 0.4 ? 1 : 0);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.options.keyboard) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.prev();
    }
  };

  private handleMouseEnter = (): void => {
    this.hovering = true;
    if (this.options.pauseOnHover) this.clearAutoplay();
  };

  private handleMouseLeave = (): void => {
    this.hovering = false;
    this.scheduleAutoplay();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.effectGeneration += 1;
    cancelAnimationFrame(this.frameId);
    this.clearAutoplay();
    this.tween?.kill();
    this.resizeObserver.disconnect();
    this.host.removeEventListener('pointerdown', this.handlePointerDown);
    this.host.removeEventListener('pointermove', this.handlePointerMove);
    this.host.removeEventListener('pointerup', this.handlePointerUp);
    this.host.removeEventListener('pointercancel', this.handlePointerUp);
    this.host.removeEventListener('keydown', this.handleKeyDown);
    this.host.removeEventListener('mouseenter', this.handleMouseEnter);
    this.host.removeEventListener('mouseleave', this.handleMouseLeave);
    this.activeEffect?.destroy();
    this.images.forEach((image) => image.release());
    this.host.remove();
    this.emit('destroy', {});
    this.listeners.clear();
  }
}
