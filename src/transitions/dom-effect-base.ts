import type {
  Direction,
  LoadedImage,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
  VaryloomImageFit,
} from '../types';

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const smooth = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const hash = (value: number): number => {
  const x = Math.sin(value * 127.1 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const setFull = (node: HTMLElement): void => {
  Object.assign(node.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
};

export function makeImage(url: string, fit: VaryloomImageFit = 'contain'): HTMLImageElement {
  const image = document.createElement('img');
  image.src = url;
  image.alt = '';
  image.draggable = false;
  setFull(image);
  Object.assign(image.style, {
    display: 'block', objectFit: fit, pointerEvents: 'none', userSelect: 'none', maxWidth: 'none',
  });
  return image;
}

function imageUrl(item: LoadedImage): string {
  if (item.source instanceof HTMLImageElement) return item.source.currentSrc || item.source.src;
  const surface = document.createElement('canvas');
  surface.width = item.width;
  surface.height = item.height;
  const ctx = surface.getContext('2d');
  if (!ctx) throw new Error('2D canvas is required for this Varyloom transition.');
  ctx.drawImage(item.source, 0, 0);
  return surface.toDataURL();
}

export abstract class DomEffectBase implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  protected readonly layer = document.createElement('div');
  protected items: LoadedImage[] = [];
  protected urls: string[] = [];
  protected fromIndex = 0;
  protected toIndex = 0;
  protected direction: Direction = 1;
  protected width = 1;
  protected height = 1;
  protected dpr = 1;
  protected fit: VaryloomImageFit = 'contain';
  private context2d!: CanvasRenderingContext2D;

  init(context: TransitionEffectContext): void {
    const drawing = this.canvas.getContext('2d', { alpha: false });
    if (!drawing) throw new Error('2D canvas is required for this Varyloom transition.');
    this.context2d = drawing;
    this.items = context.items;
    this.urls = context.items.map(imageUrl);
    this.fit = context.options.imageFit === 'cover' ? 'cover' : 'contain';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0' });
    setFull(this.layer);
    Object.assign(this.layer.style, { pointerEvents: 'none', overflow: 'hidden' });
    context.host.append(this.canvas, this.layer);
    this.resize(context.width, context.height, context.dpr);
  }

  prepare(fromIndex: number, toIndex: number, direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.direction = direction;
    this.layer.replaceChildren();
    this.build();
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.onResize();
  }

  render(frame: TransitionFrame): void {
    const fit = frame.options.imageFit === 'cover' ? 'cover' : 'contain';
    if (fit !== this.fit) {
      this.fit = fit;
      this.layer.querySelectorAll('img').forEach((image) => { image.style.objectFit = fit; });
    }
    this.drawBase(frame);
    this.renderDom(frame);
  }

  destroy(): void {
    this.layer.remove();
    this.canvas.remove();
  }

  protected drawBase(frame: TransitionFrame): void {
    this.drawImage(frame.progress >= 1 || this.fromIndex === this.toIndex ? this.toIndex : this.fromIndex);
  }

  protected drawImage(index: number, background = '#101419'): void {
    const ctx = this.context2d;
    const image = this.items[index];
    const scale = this.fit === 'cover'
      ? Math.max(this.canvas.width / image.width, this.canvas.height / image.height)
      : Math.min(this.canvas.width / image.width, this.canvas.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(image.source, (this.canvas.width - w) * 0.5, (this.canvas.height - h) * 0.5, w, h);
  }

  protected fillBase(color: string): void {
    this.context2d.fillStyle = color;
    this.context2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  protected photo(index: number): HTMLImageElement {
    return makeImage(this.urls[index], this.fit);
  }

  protected onResize(): void { /* optional */ }
  protected abstract build(): void;
  protected abstract renderDom(frame: TransitionFrame): void;
}
