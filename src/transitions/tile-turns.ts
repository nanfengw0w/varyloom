import type { TransitionDefinition, TransitionFrame, VaryloomImageFit } from '../types';
import { clamp01, DomEffectBase, hash, makeImage, mix, smooth } from './dom-effect-base';

export interface DrowsyBlindsOptions { imageFit?: VaryloomImageFit; }
export interface MemoryMosaicOptions { imageFit?: VaryloomImageFit; }
export interface IrisShutterOptions { imageFit?: VaryloomImageFit; }

const positioned = (node: HTMLElement, values: Partial<CSSStyleDeclaration>): void => {
  Object.assign(node.style, { position: 'absolute', boxSizing: 'border-box', ...values });
};

function croppedFace(url: string, fit: VaryloomImageFit, width: number, height: number, left: number, top: number): HTMLDivElement {
  const face = document.createElement('div');
  positioned(face, {
    inset: '0', overflow: 'hidden', backfaceVisibility: 'hidden', webkitBackfaceVisibility: 'hidden',
    background: '#101419', transform: 'translateZ(1px)',
  });
  const image = makeImage(url, fit);
  positioned(image, { width: `${width}px`, height: `${height}px`, left: `${-left}px`, top: `${-top}px` });
  face.append(image);
  return face;
}

class DrowsyBlindsEffect extends DomEffectBase {
  private leaves: Array<{ leaf: HTMLDivElement; rotor: HTMLDivElement; shade: HTMLDivElement }> = [];

  protected build(): void {
    this.layer.replaceChildren();
    this.layer.style.perspective = '1050px';
    this.leaves = [];
    if (this.fromIndex === this.toIndex) return;
    const count = 10;
    for (let index = 0; index < count; index++) {
      const top = Math.round(index * this.height / count);
      const bottom = Math.round((index + 1) * this.height / count);
      const leaf = document.createElement('div');
      const rotor = document.createElement('div');
      positioned(leaf, { left: '0', top: `${top}px`, width: '100%', height: `${bottom - top + 0.5}px`,
        visibility: 'hidden', transformStyle: 'preserve-3d' });
      positioned(rotor, { inset: '0', transformStyle: 'preserve-3d', transformOrigin: '50% 50%' });
      const front = croppedFace(this.urls[this.fromIndex], this.fit, this.width, this.height, 0, top);
      const back = croppedFace(this.urls[this.toIndex], this.fit, this.width, this.height, 0, top);
      back.style.transform = 'rotateX(180deg) translateZ(1px)';
      const shade = document.createElement('div');
      positioned(shade, { inset: '0', pointerEvents: 'none', opacity: '0',
        background: 'linear-gradient(180deg, #0000 12%, #0714124d 80%, #0714128c)' });
      front.append(shade);
      rotor.append(front, back);
      leaf.append(rotor);
      this.layer.append(leaf);
      this.leaves.push({ leaf, rotor, shade });
    }
  }

  protected onResize(): void { if (this.items.length) this.build(); }

  protected renderDom(frame: TransitionFrame): void {
    const p = frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 || this.fromIndex === this.toIndex ? 'hidden' : 'visible';
    this.leaves.forEach(({ leaf, rotor, shade }, index) => {
      const pair = Math.floor(index / 2);
      const start = pair / 4 * 0.23 + (index % 2) * 0.02;
      const q = clamp01((p - start) / 0.75);
      leaf.style.visibility = p < start + 0.008 ? 'hidden' : 'visible';
      let angle: number;
      if (q < 0.13) angle = 10 * smooth(q / 0.13);
      else if (q < 0.74) angle = mix(10, 173, smooth((q - 0.13) / 0.61));
      else if (q < 0.86) angle = mix(173, 184, smooth((q - 0.74) / 0.12));
      else angle = mix(184, 180, smooth((q - 0.86) / 0.14));
      rotor.style.transform = `rotateX(${angle}deg)`;
      shade.style.opacity = String(0.43 * smooth((q - 0.12) / 0.34) * (1 - smooth((q - 0.48) / 0.44)));
    });
  }
}

class MemoryMosaicEffect extends DomEffectBase {
  private tiles: Array<{ tile: HTMLDivElement; flipper: HTMLDivElement; row: number; col: number }> = [];
  private static readonly cols = 14;
  private static readonly rows = 9;

  protected build(): void {
    this.layer.replaceChildren();
    this.layer.style.perspective = '1200px';
    this.layer.style.transformStyle = 'preserve-3d';
    this.tiles = [];
    if (this.fromIndex === this.toIndex) return;
    for (let row = 0; row < MemoryMosaicEffect.rows; row++) {
      for (let col = 0; col < MemoryMosaicEffect.cols; col++) {
        const left = Math.round(col * this.width / MemoryMosaicEffect.cols);
        const right = Math.round((col + 1) * this.width / MemoryMosaicEffect.cols);
        const top = Math.round(row * this.height / MemoryMosaicEffect.rows);
        const bottom = Math.round((row + 1) * this.height / MemoryMosaicEffect.rows);
        const tile = document.createElement('div');
        const flipper = document.createElement('div');
        positioned(tile, { left: `${left}px`, top: `${top}px`, width: `${right - left + 0.7}px`,
          height: `${bottom - top + 0.7}px`, transformStyle: 'preserve-3d', willChange: 'transform' });
        positioned(flipper, { inset: '0', transformStyle: 'preserve-3d', willChange: 'transform' });
        const front = croppedFace(this.urls[this.fromIndex], this.fit, this.width, this.height, left, top);
        const back = croppedFace(this.urls[this.toIndex], this.fit, this.width, this.height, left, top);
        back.style.transform = 'rotateY(180deg) translateZ(1px)';
        flipper.append(front, back);
        tile.append(flipper);
        this.layer.append(tile);
        this.tiles.push({ tile, flipper, row, col });
      }
    }
  }

  protected onResize(): void { if (this.items.length) this.build(); }

  protected renderDom(frame: TransitionFrame): void {
    const p = frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 || this.fromIndex === this.toIndex ? 'hidden' : 'visible';
    this.canvas.style.filter = p > 0 && p < 1 ? 'blur(10px) brightness(.55) saturate(.7)' : 'none';
    const cols = MemoryMosaicEffect.cols;
    const rows = MemoryMosaicEffect.rows;
    const maxRadius = Math.hypot((cols - 1) / 2, (rows - 1) / 2);
    this.tiles.forEach(({ tile, flipper, row, col }) => {
      const index = row * cols + col;
      const dx = col - (cols - 1) / 2;
      const dy = row - (rows - 1) / 2;
      const radius = Math.hypot(dx, dy);
      const angle = radius > 0.01 ? Math.atan2(dy, dx) : hash(index) * Math.PI * 2;
      const normalized = radius / maxRadius;
      const start = Math.max(0, 0.285 * normalized + 0.022 * (hash(index + 12) - 0.5));
      const travel = 15 + 13 * (1 - normalized) + hash(index + 64) * 7;
      const driftX = Math.cos(angle) * travel + (hash(index + 87) - 0.5) * 11;
      const driftY = Math.sin(angle) * travel + (hash(index + 104) - 0.5) * 11;
      const lift = smooth((p - start) / 0.15) * (1 - smooth((p - start - 0.37) / 0.26));
      const depth = 54 + hash(index + 141) * 34;
      const tilt = (hash(index + 179) - 0.5) * 15;
      const spin = (hash(index + 229) - 0.5) * 14;
      tile.style.transform = `translate3d(${driftX * lift}px,${driftY * lift}px,${depth * lift}px) rotateX(${tilt * lift}deg) rotateZ(${spin * lift}deg) scale(${1 - 0.04 * lift})`;
      tile.style.boxShadow = `0 ${12 * lift}px ${21 * lift}px rgba(0,0,0,${0.5 * lift})`;
      const rotation = hash(index + 271) < 0.5 ? -180 : 180;
      flipper.style.transform = `rotateY(${rotation * smooth((p - start - 0.075) / 0.34)}deg)`;
    });
  }
}

class IrisShutterEffect extends DomEffectBase {
  private petals: HTMLDivElement[] = [];
  private optic!: HTMLDivElement;

  protected build(): void {
    this.layer.replaceChildren();
    this.layer.style.perspective = '1100px';
    this.layer.style.transformStyle = 'preserve-3d';
    this.petals = [];
    if (this.fromIndex === this.toIndex) return;
    const radius = Math.hypot(this.width / 2, this.height / 2) * 1.08;
    const side = radius * 2;
    for (let index = 0; index < 12; index++) {
      const from = index * 30 - 90;
      const points = [`${radius}px ${radius}px`];
      for (let angle = from; angle <= from + 30.01; angle += 1.5) {
        const rad = angle * Math.PI / 180;
        points.push(`${radius + Math.cos(rad) * radius}px ${radius + Math.sin(rad) * radius}px`);
      }
      const clip = `polygon(${points.join(',')})`;
      const petal = document.createElement('div');
      positioned(petal, { left: `${this.width / 2 - radius}px`, top: `${this.height / 2 - radius}px`,
        width: `${side}px`, height: `${side}px`, transformStyle: 'preserve-3d', transformOrigin: '50% 50%',
        willChange: 'transform' });
      for (const [faceIndex, itemIndex] of [[0, this.fromIndex], [1, this.toIndex]]) {
        const face = document.createElement('div');
        positioned(face, { inset: '0', overflow: 'hidden', clipPath: clip, backfaceVisibility: 'hidden',
          webkitBackfaceVisibility: 'hidden', transform: faceIndex === 0 ? 'translateZ(2px)' : 'rotateY(180deg) translateZ(2px)' });
        const image = makeImage(this.urls[itemIndex], this.fit);
        positioned(image, { left: `${radius - this.width / 2}px`, top: `${radius - this.height / 2}px`,
          width: `${this.width}px`, height: `${this.height}px` });
        face.append(image);
        petal.append(face);
      }
      this.layer.append(petal);
      this.petals.push(petal);
    }
    this.optic = document.createElement('div');
    positioned(this.optic, { left: '50%', top: '50%', width: '180px', height: '180px',
      border: '1px solid #f8eac3bd', borderRadius: '50%', boxShadow: '0 0 0 7px #f8edcb0e, 0 0 36px #f8dd9a20, inset 0 0 19px #eacb813d',
      pointerEvents: 'none', opacity: '0' });
    this.layer.append(this.optic);
  }

  protected onResize(): void { if (this.items.length) this.build(); }

  protected drawBase(frame: TransitionFrame): void {
    if (frame.progress <= 0 || frame.progress >= 1 || this.fromIndex === this.toIndex) super.drawBase(frame);
    else this.fillBase('#24342f');
  }

  protected renderDom(frame: TransitionFrame): void {
    const p = frame.progress;
    this.layer.style.visibility = p <= 0 || p >= 1 || this.fromIndex === this.toIndex ? 'hidden' : 'visible';
    if (this.fromIndex === this.toIndex) return;
    this.petals.forEach((petal, index) => {
      const offset = index / 12 * 0.085;
      const close = smooth((p - offset) / 0.45);
      const open = smooth((p - 0.5 - offset * 0.4) / 0.5);
      const scale = mix(mix(1, 0.34, close), 1, open);
      const spiral = 27 + (index % 3) * 2.4;
      const rotation = mix(spiral * close, 0, open);
      const flip = 180 * smooth((p - 0.345 - offset * 0.6) / 0.31);
      petal.style.transform = `rotate(${rotation}deg) rotateY(${flip}deg) scale(${scale})`;
    });
    const glow = smooth((p - 0.08) / 0.34) * (1 - smooth((p - 0.5) / 0.38));
    this.optic.style.opacity = String(0.72 * glow);
    this.optic.style.transform = `translate(-50%,-50%) scale(${mix(1.4, 0.92, smooth(p / 0.42))}) rotate(${mix(-30, 36, p)}deg)`;
  }
}

export const drowsyBlindsTransition: TransitionDefinition = {
  name: 'drowsy-blinds', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new DrowsyBlindsEffect(),
};
export const memoryMosaicTransition: TransitionDefinition = {
  name: 'memory-mosaic', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new MemoryMosaicEffect(),
};
export const irisShutterTransition: TransitionDefinition = {
  name: 'iris-shutter', backend: 'custom', defaults: { imageFit: 'contain' }, phaseEasing: 'none',
  create: () => new IrisShutterEffect(),
};
