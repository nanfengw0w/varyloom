# Prismorph

Extensible GPU-powered image transitions for the web. Prismorph ships with five transitions and one controller API for vanilla JavaScript, TypeScript, and React.

> Status: `0.1.0` review build. This package is not published yet.

## Highlights

- `ink-reveal` — WebGL2 ink/noise reveal with a subtle grey-to-final-colour delay.
- `particle-shift` — WebGPU particle dispersal and independent particle assembly, powered by `wgpu-kit`.
- `melt` — OGL/GLSL fluid melt with chromatic aberration and pointer drift.
- `prismatic-glass` — WebGL2 refractive glass front with spectral dispersion and caustic edge light.
- `silk-ribbons` — WebGL2 curved silk strips with synchronized outgoing and incoming edges.
- Shared timing, autoplay, keyboard, drag, events, responsive resize, cleanup, and fallback handling.
- A transition registry designed for adding future effects without changing the controller.
- ESM and TypeScript declarations, plus an optional React component.

## Install

```bash
npm install prismorph
```

The command above is for the eventual published package. During review, install the generated `.tgz` file instead.

## Vanilla JavaScript

```ts
import { createPrismorph } from 'prismorph';

const slider = await createPrismorph(document.querySelector('#slider')!, {
  items: [
    { image: '/images/one.jpg', caption: 'One' },
    { image: '/images/two.jpg', caption: 'Two' },
    { image: '/images/three.jpg', caption: 'Three' },
  ],
  effect: 'ink-reveal',
  duration: 1.6,
  autoplay: true,
  autoplayDelay: 4,
  effectOptions: {
    edgeStrength: 0.72,
    colorLag: 0.07,
  },
});

slider.on('indexchange', ({ index, item }) => {
  console.log(index, item.caption);
});

slider.next();
```

Give the container an explicit size:

```css
#slider {
  width: min(100%, 900px);
  aspect-ratio: 16 / 10;
}
```

## React

```tsx
import { PrismorphSlider } from 'prismorph/react';

export function Gallery() {
  return (
    <div style={{ height: 500 }}>
      <PrismorphSlider
        items={items}
        effect="melt"
        duration={1.1}
        effectOptions={{ intensity: 0.55, aberration: 0.35, drift: 0.4 }}
        autoplay
      />
    </div>
  );
}
```

The component destroys GPU resources, observers, animation frames, timers, and listeners when it unmounts.

## Common options

| Option | Default | Purpose |
| --- | --- | --- |
| `items` | required | Two or more image items. A source can be a URL, `Blob`, `HTMLImageElement`, or `ImageBitmap`. |
| `effect` | `ink-reveal` | Any registered transition name. |
| `duration` | `1.2` | Transition duration in seconds. |
| `easing` | `power2.inOut` | GSAP easing string. Simulation-based effects can own their phase easing. |
| `autoplay` | `false` | Enables automatic navigation. |
| `autoplayDelay` | `4` | Delay between autoplay transitions, in seconds. |
| `loop` | `true` | Wraps at the first and last item. |
| `draggable` | `true` | Enables horizontal drag-to-scrub. |
| `keyboard` | `true` | Enables left/right arrow navigation when focused. |
| `dpr` | `2` | Maximum device-pixel ratio used by effects. |
| `fallbackEffect` | `melt` | Used when a requested backend is unavailable; set `false` to throw instead. |
| `effectOptions` | `{}` | Options forwarded to the active transition. |

## Built-in effect options

```ts
import type {
  InkRevealOptions,
  MeltOptions,
  ParticleShiftOptions,
  PrismaticGlassOptions,
  SilkRibbonsOptions,
} from 'prismorph';
```

| Effect | Options |
| --- | --- |
| `ink-reveal` | `edgeStrength`, `colorLag`, `debugField` |
| `particle-shift` | `particleCount`, `particleSize`, `turbulence`, `exitDirection`, `enterDirection` |
| `melt` | `intensity`, `scale`, `aberration`, `drift`, `overlayColor` |
| `prismatic-glass` | `direction`, `refraction`, `dispersion`, `curvature`, `edgeGlow` |
| `silk-ribbons` | `direction`, `ribbonCount`, `curl`, `stagger`, `sheen` |

All five built-in effects also accept `imageFit: 'cover' | 'contain'`. Directional effects accept `direction: 'auto' | 'right' | 'left' | 'down' | 'up'`; `auto` follows next/previous navigation.

For `particle-shift`, the entry side defaults to the opposite of the exit direction. Its simulation clock remains linear so dispersal and assembly keep their designed separation, while motion and image sampling are normalized for arbitrary container ratios. WebGPU support is checked before the effect mounts.

## Controller

```ts
slider.next();
slider.prev();
slider.goTo(2);
slider.seek(0.5);
slider.play();
slider.pause();
await slider.setEffect('particle-shift', { exitDirection: 'right' });
slider.setOptions({ duration: 2.2, autoplay: false });
slider.destroy();
```

Events: `ready`, `transitionstart`, `progress`, `indexchange`, `transitionend`, `effectchange`, `fallback`, `error`, and `destroy`.

## Add a transition

The controller is renderer-agnostic. A custom transition only needs the lifecycle below:

```ts
import { defineTransition, registerTransition } from 'prismorph';

const unregister = registerTransition(defineTransition({
  name: 'my-transition',
  backend: 'custom',
  // Optional: lock the effect's phase clock independently of the slider easing.
  phaseEasing: 'none',
  defaults: { strength: 0.5 },
  supported: () => true,
  create: () => ({
    canvas: document.createElement('canvas'),
    init(context) {
      context.host.appendChild(this.canvas);
    },
    prepare(fromIndex, toIndex, direction) {},
    resize(width, height, dpr) {},
    render(frame) {},
    destroy() {
      this.canvas.remove();
    },
  }),
}));

// unregister() removes it again.
```

`init` receives the preloaded images, host size, DPR, effect options, and an error reporter. `render` receives normalized progress, elapsed time, frame delta, direction, pointer position, and options.

## Browser requirements

- `ink-reveal`: WebGL2.
- `melt`: WebGL.
- `particle-shift`: WebGPU. If unavailable, Prismorph uses `fallbackEffect`.
- `prismatic-glass`: WebGL2.
- `silk-ribbons`: WebGL2.

Cross-origin images must return appropriate CORS headers. For accessibility, reduced-motion preferences shorten transitions automatically.

## Local review commands

```bash
npm run build:prismorph
npm run test:prismorph
npm run pack:prismorph
```

The last command creates a local tarball only. It does not publish or authenticate with npm.
