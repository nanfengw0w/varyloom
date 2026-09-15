export type BuiltInTransitionName =
  | 'ink-reveal'
  | 'particle-shift'
  | 'melt'
  | 'prismatic-glass'
  | 'silk-ribbons'
  | 'misregistration'
  | 'burn-through';
export type TransitionName = BuiltInTransitionName | (string & {});
export type TransitionBackend = 'webgl2' | 'webgpu' | 'ogl' | 'custom';
export type Direction = -1 | 1;
export type PrismorphImageFit = 'cover' | 'contain';

export type PrismorphImageSource = string | Blob | HTMLImageElement | ImageBitmap;

export interface PrismorphItem<TData = unknown> {
  image: PrismorphImageSource;
  alt?: string;
  caption?: string;
  data?: TData;
}

export interface LoadedImage<TData = unknown> extends PrismorphItem<TData> {
  source: HTMLImageElement | ImageBitmap;
  width: number;
  height: number;
  release(): void;
}

export interface PrismorphOptions<TData = unknown> {
  items: Array<PrismorphItem<TData>>;
  effect?: TransitionName;
  duration?: number;
  easing?: string;
  startIndex?: number;
  autoplay?: boolean;
  autoplayDelay?: number;
  loop?: boolean;
  draggable?: boolean;
  keyboard?: boolean;
  pauseOnHover?: boolean;
  preload?: 'all';
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  dpr?: number;
  fallbackEffect?: TransitionName | false;
  effectOptions?: Record<string, unknown>;
  registry?: TransitionRegistryLike;
}

export interface ResolvedPrismorphOptions<TData = unknown> extends Omit<PrismorphOptions<TData>, 'effect' | 'duration' | 'easing' | 'startIndex' | 'autoplay' | 'autoplayDelay' | 'loop' | 'draggable' | 'keyboard' | 'pauseOnHover' | 'preload' | 'crossOrigin' | 'dpr' | 'fallbackEffect' | 'effectOptions'> {
  effect: TransitionName;
  duration: number;
  easing: string;
  startIndex: number;
  autoplay: boolean;
  autoplayDelay: number;
  loop: boolean;
  draggable: boolean;
  keyboard: boolean;
  pauseOnHover: boolean;
  preload: 'all';
  crossOrigin: '' | 'anonymous' | 'use-credentials';
  dpr: number;
  fallbackEffect: TransitionName | false;
  effectOptions: Record<string, unknown>;
}

export interface TransitionPointer {
  x: number;
  y: number;
}

export interface TransitionFrame {
  progress: number;
  time: number;
  delta: number;
  duration: number;
  direction: Direction;
  active: boolean;
  pointer: TransitionPointer;
  options: Readonly<Record<string, unknown>>;
}

export interface TransitionEffectContext<TData = unknown> {
  host: HTMLElement;
  items: Array<LoadedImage<TData>>;
  width: number;
  height: number;
  dpr: number;
  options: Readonly<Record<string, unknown>>;
  reportError(error: Error): void;
}

export interface TransitionEffect<TData = unknown> {
  readonly canvas: HTMLCanvasElement;
  readonly continuous?: boolean;
  init(context: TransitionEffectContext<TData>): void | Promise<void>;
  prepare(fromIndex: number, toIndex: number, direction: Direction): void | Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  render(frame: TransitionFrame): void | Promise<void>;
  destroy(): void;
}

export interface TransitionDefinition<TData = unknown> {
  name: TransitionName;
  backend: TransitionBackend;
  defaults?: Record<string, unknown>;
  /** Optional effect-owned phase easing. Use "none" for simulation clocks that must stay linear. */
  phaseEasing?: string;
  supported?: () => boolean | Promise<boolean>;
  create: () => TransitionEffect<TData>;
}

export interface TransitionRegistryLike {
  get(name: TransitionName): TransitionDefinition | undefined;
  list(): TransitionDefinition[];
}

export interface PrismorphEventMap<TData = unknown> {
  ready: { effect: TransitionName; index: number };
  transitionstart: { from: number; to: number; direction: Direction };
  progress: { from: number; to: number; progress: number };
  indexchange: { index: number; item: PrismorphItem<TData> };
  transitionend: { index: number };
  effectchange: { effect: TransitionName; requestedEffect: TransitionName };
  fallback: { requestedEffect: TransitionName; fallbackEffect: TransitionName };
  error: { error: Error };
  destroy: Record<string, never>;
}

export type PrismorphEventName = keyof PrismorphEventMap;
export type PrismorphEventListener<TData, TName extends PrismorphEventName> = (
  payload: PrismorphEventMap<TData>[TName],
) => void;

export interface PrismorphController<TData = unknown> {
  readonly ready: Promise<void>;
  readonly currentIndex: number;
  readonly effect: TransitionName;
  readonly isTransitioning: boolean;
  next(): void;
  prev(): void;
  goTo(index: number): void;
  play(): void;
  pause(): void;
  seek(progress: number): void;
  setEffect(name: TransitionName, options?: Record<string, unknown>): Promise<void>;
  setOptions(options: Partial<Omit<PrismorphOptions<TData>, 'items' | 'registry'>>): void;
  on<TName extends PrismorphEventName>(
    name: TName,
    listener: PrismorphEventListener<TData, TName>,
  ): () => void;
  destroy(): void;
}
