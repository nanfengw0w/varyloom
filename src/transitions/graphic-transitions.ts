import type { TransitionDefinition, TransitionFrame, VaryloomImageFit } from '../types';
import { clamp01, DomEffectBase, makeImage, mix, smooth } from './dom-effect-base';

export interface PostcardRelayOptions { imageFit?: VaryloomImageFit; }
export interface ArchiveSealOptions { imageFit?: VaryloomImageFit; }
export interface ContactSheetOptions { imageFit?: VaryloomImageFit; }
export interface TypeApertureOptions { imageFit?: VaryloomImageFit; word?: string; }

const full = (node: HTMLElement): void => {
  Object.assign(node.style, { position: 'absolute', inset: '0', boxSizing: 'border-box' });
};

function postcard(url: string, label: string, fit: VaryloomImageFit): HTMLDivElement {
  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'absolute', left: '14%', top: '11%', width: '72%', height: '78%', boxSizing: 'border-box',
    padding: '2.2% 2.2% 0', background: '#fffcf7', border: '1px solid #e4d9d3', borderRadius: '3px',
    display: 'flex', flexDirection: 'column', boxShadow: '0 13px 26px #66556124, 0 2px 6px #66556118',
    transformStyle: 'preserve-3d', willChange: 'transform',
  });
  const frame = document.createElement('div');
  Object.assign(frame.style, { position: 'relative', minHeight: '0', flex: '1', background: '#eadfda', overflow: 'hidden' });
  frame.append(makeImage(url, fit));
  const footer = document.createElement('div');
  footer.textContent = label;
  Object.assign(footer.style, { height: '12%', minHeight: '22px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', color: '#826f76', font: '600 11px ui-monospace, monospace',
    letterSpacing: '.1em', whiteSpace: 'nowrap', overflow: 'hidden' });
  card.append(frame, footer);
  return card;
}

class PostcardRelayEffect extends DomEffectBase {
  private outgoing!: HTMLDivElement;
  private incoming!: HTMLDivElement;

  protected build(): void {
    this.layer.replaceChildren();
    this.layer.style.perspective = '1300px';
    this.incoming = postcard(this.urls[this.fromIndex === this.toIndex
      ? (this.fromIndex + 1) % this.urls.length : this.toIndex],
      String((this.fromIndex === this.toIndex ? this.fromIndex + 1 : this.toIndex) % this.urls.length + 1).padStart(2, '0'), this.fit);
    this.outgoing = postcard(this.urls[this.fromIndex], String(this.fromIndex + 1).padStart(2, '0'), this.fit);
    this.incoming.style.zIndex = '1';
    this.outgoing.style.zIndex = '2';
    this.layer.append(this.incoming, this.outgoing);
  }

  protected onResize(): void { if (this.items.length && this.urls.length) this.build(); }
  protected drawBase(): void { this.fillBase('#efe4df'); }

  protected renderDom(frame: TransitionFrame): void {
    const p = this.fromIndex === this.toIndex ? 0 : frame.progress;
    const sign = this.direction;
    const lift = smooth(p / 0.24) * (1 - smooth((p - 0.12) / 0.69));
    const pass = smooth((p - 0.12) / 0.69);
    const distance = this.width * 1.14;
    const x = -sign * distance * pass;
    const y = -28 * lift - 76 * pass;
    const angle = -sign * (3.2 * lift + 14 * pass);
    this.outgoing.style.transform = `translate3d(${x}px,${y}px,${54 * lift + 30 * pass}px) rotate(${angle}deg) rotateY(${sign * (5 * lift + 10 * pass)}deg) scale(${1 + 0.025 * lift - 0.03 * pass})`;
    this.outgoing.style.boxShadow = `0 ${13 + 23 * lift}px ${26 + 39 * lift}px rgba(82,64,78,${0.14 + 0.12 * lift})`;
    const arrive = smooth((p - 0.16) / 0.63);
    const settle = smooth((p - 0.79) / 0.2);
    this.incoming.style.transform = `translate3d(${sign * 35 * (1 - arrive)}px,${mix(22, -7, arrive) * (1 - settle)}px,0) rotate(${sign * 5 * (1 - arrive) - sign * 1.25 * arrive * (1 - settle)}deg) scale(${mix(0.96, 1.008, arrive) * (1 - settle) + settle})`;
    this.outgoing.style.visibility = p >= 1 ? 'hidden' : 'visible';
  }
}

let apertureSerial = 0;
class TypeApertureEffect extends DomEffectBase {
  private svg!: SVGSVGElement;
  private currentImage!: SVGImageElement;
  private incomingImage!: SVGImageElement;
  private intro!: SVGRectElement;
  private aperture!: SVGRectElement;
  private glyph!: SVGTextElement;
  private word = 'NEXT';

  init(context: Parameters<DomEffectBase['init']>[0]): void {
    this.word = typeof context.options.word === 'string' ? context.options.word.slice(0, 12) || 'NEXT' : 'NEXT';
    super.init(context);
  }

  protected build(): void {
    this.layer.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const make = <T extends SVGElement>(tag: string): T => document.createElementNS(ns, tag) as T;
    const id = `varyloom-aperture-${++apertureSerial}`;
    this.svg = make<SVGSVGElement>('svg');
    Object.assign(this.svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const defs = make<SVGDefsElement>('defs');
    const clip = make<SVGClipPathElement>('clipPath');
    clip.id = `${id}-clip`;
    this.intro = make<SVGRectElement>('rect');
    clip.append(this.intro);
    const mask = make<SVGMaskElement>('mask');
    mask.id = `${id}-mask`;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    mask.setAttribute('style', 'mask-type:luminance');
    const black = make<SVGRectElement>('rect');
    black.setAttribute('fill', '#000');
    this.glyph = make<SVGTextElement>('text');
    this.glyph.setAttribute('fill', '#fff');
    this.glyph.setAttribute('font-family', 'Impact, Arial Narrow, sans-serif');
    this.glyph.setAttribute('font-weight', '900');
    this.glyph.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    this.glyph.textContent = this.word;
    this.aperture = make<SVGRectElement>('rect');
    this.aperture.setAttribute('fill', '#fff');
    mask.append(black, this.glyph, this.aperture);
    defs.append(clip, mask);
    this.currentImage = make<SVGImageElement>('image');
    this.currentImage.setAttribute('href', this.urls[this.fromIndex]);
    this.incomingImage = make<SVGImageElement>('image');
    this.incomingImage.setAttribute('href', this.urls[this.toIndex]);
    const incomingGroup = make<SVGGElement>('g');
    incomingGroup.setAttribute('mask', `url(#${id}-mask)`);
    incomingGroup.setAttribute('clip-path', `url(#${id}-clip)`);
    incomingGroup.append(this.incomingImage);
    this.svg.append(defs, this.currentImage, incomingGroup);
    this.layer.append(this.svg);
    this.onResize();
  }

  protected onResize(): void {
    if (!this.svg) return;
    const w = this.width, h = this.height;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    for (const image of [this.currentImage, this.incomingImage]) {
      image.setAttribute('x', '0'); image.setAttribute('y', '0');
      image.setAttribute('width', String(w)); image.setAttribute('height', String(h));
      image.setAttribute('preserveAspectRatio', this.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
    }
    this.intro.setAttribute('x', '0'); this.intro.setAttribute('y', '0');
    this.intro.setAttribute('height', String(h));
    this.aperture.setAttribute('x', '0'); this.aperture.setAttribute('y', '0');
    this.aperture.setAttribute('width', String(w)); this.aperture.setAttribute('height', String(h));
    this.glyph.setAttribute('x', String(w * 0.045));
    this.glyph.setAttribute('y', String(h * 0.615));
    this.glyph.setAttribute('font-size', String(h * 0.558));
    this.glyph.setAttribute('textLength', String(w * 0.91));
    const black = this.svg.querySelector('mask rect:first-child');
    black?.setAttribute('width', String(w)); black?.setAttribute('height', String(h));
  }

  protected renderDom(frame: TransitionFrame): void {
    const p = this.fromIndex === this.toIndex ? 1 : frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 ? 'hidden' : 'visible';
    for (const image of [this.currentImage, this.incomingImage]) {
      image.setAttribute('preserveAspectRatio', this.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
    }
    const w = this.width, h = this.height;
    this.intro.setAttribute('width', String(w * smooth((p - 0.01) / 0.3)));
    const scale = 1.2 * smooth((p - 0.34) / 0.64);
    this.aperture.setAttribute('transform', `translate(${w / 2} ${h / 2}) scale(${scale}) translate(${-w / 2} ${-h / 2})`);
    this.glyph.setAttribute('transform', `translate(${mix(-w * 0.024, 0, smooth(p / 0.32))} 0) scale(${mix(0.92, 1.08, smooth(p / 0.32))} 1)`);
    this.currentImage.setAttribute('transform', `translate(${-w * 0.028 * smooth(p / 0.85)} ${h * 0.019 * smooth(p / 0.85)})`);
  }
}

function slicePolygon(index: number, count: number): string {
  const boundary = (edge: number, top: boolean): number => {
    if (edge === 0) return 0;
    if (edge === count) return 100;
    return edge * 100 / count + (top ? -2.2 : 2.2);
  };
  return `polygon(${boundary(index, true)}% 0%, ${boundary(index + 1, true)}% 0%, ${boundary(index + 1, false)}% 100%, ${boundary(index, false)}% 100%)`;
}

class ArchiveSealEffect extends DomEffectBase {
  private outgoing: HTMLDivElement[] = [];
  private incoming: HTMLDivElement[] = [];
  private seal!: HTMLDivElement;

  protected build(): void {
    this.layer.replaceChildren();
    this.outgoing = [];
    this.incoming = [];
    if (this.fromIndex === this.toIndex) return;
    for (let index = 0; index < 6; index++) {
      for (const [group, itemIndex] of [[this.outgoing, this.fromIndex], [this.incoming, this.toIndex]] as const) {
        const strip = document.createElement('div');
        full(strip);
        strip.style.clipPath = slicePolygon(index, 6);
        strip.style.willChange = 'transform';
        strip.append(this.photo(itemIndex));
        this.layer.append(strip);
        group.push(strip);
      }
    }
    this.seal = document.createElement('div');
    this.seal.textContent = 'TRANSFER / SEALED';
    Object.assign(this.seal.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%) rotate(-8deg)',
      border: '3px solid #e2b568', padding: '12px 20px', color: '#e2b568', font: '800 20px ui-monospace, monospace',
      letterSpacing: '.18em', opacity: '0', whiteSpace: 'nowrap', textShadow: '0 2px 7px #0009' });
    this.layer.append(this.seal);
  }

  protected onResize(): void { if (this.items.length) this.build(); }

  protected drawBase(frame: TransitionFrame): void {
    if (frame.progress <= 0 || frame.progress >= 1 || this.fromIndex === this.toIndex) super.drawBase(frame);
    else this.fillBase('#171d20');
  }

  protected renderDom(frame: TransitionFrame): void {
    const p = frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 || this.fromIndex === this.toIndex ? 'hidden' : 'visible';
    if (this.fromIndex === this.toIndex) return;
    const distance = this.width * 1.09;
    this.outgoing.forEach((strip, index) => {
      const order = this.direction > 0 ? index : 5 - index;
      const q = smooth((p - order * 0.033) / 0.78);
      strip.style.transform = `translate(${-this.direction * distance * q}px,${(index % 2 ? -23 : 23) * q}px)`;
      (strip.firstElementChild as HTMLImageElement).style.objectFit = this.fit;
    });
    this.incoming.forEach((strip, index) => {
      const order = this.direction > 0 ? index : 5 - index;
      const q = smooth((p - 0.055 - order * 0.035) / 0.78);
      strip.style.transform = `translate(${this.direction * distance * (1 - q)}px,${(index % 2 ? 18 : -18) * (1 - q)}px)`;
      (strip.firstElementChild as HTMLImageElement).style.objectFit = this.fit;
    });
    this.seal.style.opacity = String(smooth((p - 0.095) / 0.17) * (1 - smooth((p - 0.465) / 0.18)));
    this.seal.style.transform = `translate(calc(-50% + ${this.direction * mix(72, -60, p)}px),-50%) rotate(-8deg)`;
  }
}

class ContactSheetEffect extends DomEffectBase {
  private deck!: HTMLDivElement;
  private cells: HTMLDivElement[] = [];
  private oldGhost!: HTMLImageElement;
  private newGhost!: HTMLImageElement;
  private positions: Array<{ x: number; y: number; scale: number }> = [];

  protected build(): void {
    this.layer.replaceChildren();
    this.cells = [];
    this.positions = [];
    if (this.fromIndex === this.toIndex) return;
    this.deck = document.createElement('div');
    full(this.deck);
    Object.assign(this.deck.style, { background: 'linear-gradient(#d4e3710d 1px, transparent 1px), linear-gradient(90deg,#d4e3710d 1px,transparent 1px), #171c18',
      backgroundSize: '42px 42px', opacity: '0' });
    this.layer.append(this.deck);
    const columns = Math.min(this.urls.length, 5);
    const rows = Math.ceil(this.urls.length / columns);
    const cellW = Math.min(this.width * 0.18, this.width * 0.9 / columns);
    const cellH = Math.min(this.height * 0.23, cellW * 9 / 16);
    const gapX = cellW * 0.08;
    const gapY = cellH * 0.35;
    const totalW = columns * cellW + (columns - 1) * gapX;
    const totalH = rows * cellH + (rows - 1) * gapY;
    this.urls.forEach((url, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      const left = (this.width - totalW) * 0.5 + col * (cellW + gapX);
      const top = (this.height - totalH) * 0.5 + row * (cellH + gapY);
      const cell = document.createElement('div');
      Object.assign(cell.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${cellW}px`, height: `${cellH}px`,
        boxSizing: 'border-box', border: '1px solid #a1b09c77', background: '#222922', opacity: '0', overflow: 'hidden' });
      cell.append(makeImage(url, this.fit));
      this.deck.append(cell);
      this.cells.push(cell);
      this.positions.push({ x: left + cellW / 2 - this.width / 2,
        y: top + cellH / 2 - this.height / 2, scale: cellW / this.width });
    });
    this.oldGhost = makeImage(this.urls[this.fromIndex], this.fit);
    this.newGhost = makeImage(this.urls[this.toIndex], this.fit);
    for (const ghost of [this.oldGhost, this.newGhost]) {
      ghost.style.transformOrigin = '50% 50%';
      ghost.style.willChange = 'transform';
      this.layer.append(ghost);
    }
  }

  protected onResize(): void { if (this.items.length) this.build(); }

  protected drawBase(frame: TransitionFrame): void {
    this.drawImage(frame.progress >= 0.53 ? this.toIndex : this.fromIndex, '#171c18');
  }

  protected renderDom(frame: TransitionFrame): void {
    const p = frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 || this.fromIndex === this.toIndex ? 'hidden' : 'visible';
    if (this.fromIndex === this.toIndex) return;
    const fadeIn = smooth((p - 0.09) / 0.28);
    const fadeOut = smooth((p - 0.77) / 0.23);
    this.deck.style.opacity = String(fadeIn * (1 - fadeOut));
    this.cells.forEach((cell, index) => {
      cell.style.opacity = String(smooth((p - 0.22 - Math.abs(index - (this.urls.length - 1) / 2) * 0.025) / 0.2));
      cell.style.outline = p > 0.42 && index === this.toIndex ? '2px solid #d4e371' : 'none';
      (cell.firstElementChild as HTMLImageElement).style.objectFit = this.fit;
    });
    const from = this.positions[this.fromIndex];
    const to = this.positions[this.toIndex];
    const collapse = smooth(p / 0.38);
    const expand = smooth((p - 0.53) / 0.46);
    this.oldGhost.style.visibility = p < 0.39 ? 'visible' : 'hidden';
    this.oldGhost.style.transform = `translate(${from.x * collapse}px,${from.y * collapse}px) scale(${mix(1, from.scale, collapse)})`;
    this.newGhost.style.visibility = p >= 0.53 ? 'visible' : 'hidden';
    this.newGhost.style.transform = `translate(${to.x * (1 - expand)}px,${to.y * (1 - expand)}px) scale(${mix(to.scale, 1, expand)})`;
    this.oldGhost.style.objectFit = this.fit;
    this.newGhost.style.objectFit = this.fit;
  }
}

export const postcardRelayTransition: TransitionDefinition = {
  name: 'postcard-relay', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new PostcardRelayEffect(),
};
export const typeApertureTransition: TransitionDefinition = {
  name: 'type-aperture', backend: 'custom', defaults: { imageFit: 'contain', word: 'NEXT' }, phaseEasing: 'none',
  create: () => new TypeApertureEffect(),
};
export const archiveSealTransition: TransitionDefinition = {
  name: 'archive-seal', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new ArchiveSealEffect(),
};
export const contactSheetTransition: TransitionDefinition = {
  name: 'contact-sheet', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new ContactSheetEffect(),
};
