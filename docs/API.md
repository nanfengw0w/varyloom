# API reference

[Chinese](./API.zh-CN.md) · [README](../README.md) · [npm package](https://www.npmjs.com/package/varyloom)

Varyloom is published as [`varyloom`](https://www.npmjs.com/package/varyloom). This reference describes the published package API.

Varyloom is a browser library. It needs an `HTMLElement` with a visible size, at least two images, and browser APIs such as `ResizeObserver` and `requestAnimationFrame`. GPU effects also need the matching graphics API. All times in the controller API are in seconds unless stated otherwise.

## Entry points

```ts
import {
  Varyloom,
  createVaryloom,
  TransitionRegistry,
  defineTransition,
  registerTransition,
  transitionRegistry,
  builtInTransitions,
  type VaryloomOptions,
  type VaryloomController,
  type TransitionDefinition,
} from 'varyloom';

import { VaryloomSlider, type VaryloomSliderProps } from 'varyloom/react';
```

The root entry also exports each built-in definition and its corresponding `*Options` type, plus the shared types from `types.ts`. `varyloom/transitions` is an export path for the built-in definitions and their option types. Importing the root entry populates the global `transitionRegistry` with the built-ins.

`createVaryloom<TData>(container, options): Promise<Varyloom<TData>>` constructs the controller and resolves after image loading and initial effect mounting. `new Varyloom<TData>(container, options)` returns immediately; its `ready: Promise<void>` represents the same initialization. An invalid container or fewer than two items makes the constructor throw synchronously; the async `createVaryloom` function instead returns a rejected Promise. Asset or initial effect failures reject `ready`; initialization also emits `error` if a listener was registered in time.

```ts
const slider = await createVaryloom(document.querySelector('#slider')!, {
  items: [
    { image: '/images/first.jpg', alt: 'First image' },
    { image: '/images/second.jpg', alt: 'Second image' },
  ],
  effect: 'ink-reveal',
});

slider.next();
slider.destroy();
```

Give the container a width and height, for example with `aspect-ratio`. The controller creates a child host that fills the container. `createVaryloom` resolves after the initial `effectchange` and `ready` events, so subscribe to those initial events on a `new Varyloom(...)` instance before awaiting `ready`, or inspect `effect` and `currentIndex` after creation.

## Items and options

```ts
type VaryloomImageSource = string | Blob | HTMLImageElement | ImageBitmap;

interface VaryloomItem<TData = unknown> {
  image: VaryloomImageSource;
  alt?: string;
  caption?: string;
  data?: TData;
}
```

`image` is required. `alt`, `caption`, and `data` are item metadata; the controller returns the original item in `indexchange`. Canvas effects do not turn `alt` into an accessible `<img>` automatically. Supply your own accessible image description and controls where needed.

| `VaryloomOptions<TData>` property | Default | Behavior |
| --- | --- | --- |
| `items: VaryloomItem<TData>[]` | Required | At least two items. All images load during initialization. |
| `effect?: TransitionName` | `'ink-reveal'` | Built-in or registered effect name. |
| `duration?: number` | `1.2` | Transition duration in seconds; clamped to at least `0`. |
| `easing?: string` | `'power2.inOut'` | GSAP ease for the progress tween, unless the definition supplies `phaseEasing`. |
| `startIndex?: number` | `0` | Initial index, wrapped into the item range even when `loop` is false. |
| `autoplay?: boolean` | `false` | Schedule navigation to the next item. |
| `autoplayDelay?: number` | `4` | Delay between completed transitions and the next autoplay step; clamped to at least `0.1`. |
| `loop?: boolean` | `true` | Wrap navigation at both ends. When false, out-of-range navigation does nothing. |
| `draggable?: boolean` | `true` | Enable horizontal pointer dragging. Release above `0.4` progress commits; otherwise it reverses. |
| `keyboard?: boolean` | `true` | Make the host focusable and respond to Left/Right arrow keys while focused. |
| `pauseOnHover?: boolean` | `true` | Clear the autoplay timer on mouse enter; schedule again on mouse leave. |
| `preload?: 'all'` | `'all'` | The only supported mode; every item is loaded before readiness. |
| `crossOrigin?: '' \| 'anonymous' \| 'use-credentials'` | `'anonymous'` | Used when creating an image from a non-`data:`/non-`blob:` URL. |
| `dpr?: number` | `2` | Device-pixel-ratio cap passed to effects; configured value is clamped to at least `1`. |
| `fallbackEffect?: TransitionName \| false` | `'melt'` | Effect to try when `supported()` reports the requested effect unsupported. `false` disables this fallback. |
| `effectOptions?: Record<string, unknown>` | `{}` | Effect-specific values, shallow-merged with the active definition's `defaults`. |
| `registry?: TransitionRegistryLike` | `transitionRegistry` | Registry used by this instance. It must provide `get(name)` and `list()`. |

The actual DPR sent to effects is `min(devicePixelRatio || 1, configured dpr)`. Viewport width and height are measured in CSS pixels, each with a minimum of `1`.

`crossOrigin` is set on newly created `Image` objects **before** assigning their URL, provided the value is nonempty and the URL is not `data:` or `blob:`. Existing `HTMLImageElement` objects retain their own CORS configuration. `Blob` sources are converted with `createImageBitmap`; caller-provided `ImageBitmap` objects are used as given. Varyloom closes only the bitmaps it created from blobs during `destroy()`. A remote server still needs suitable CORS response headers for GPU texture uploads. Image loading, decoding, texture upload, or graphics context creation can fail independently.

`VaryloomImageFit = 'cover' | 'contain'` is available to built-in effects through `effectOptions.imageFit`. The individual built-in `*Options` types expose any extra controls; `effectOptions` on the controller itself is intentionally a generic record. For example:

```ts
import type { MeltOptions } from 'varyloom';

const meltOptions = {
  imageFit: 'contain',
  intensity: 0.55,
  aberration: 0.35,
  drift: 0.4,
} satisfies MeltOptions;

await slider.setEffect('melt', meltOptions);
```

## Built-in effect options

The tables below list the options accepted by each effect through `effectOptions` or `setEffect(name, options)`. Defaults come from the corresponding transition definition. Numeric options have effect-specific scales; Varyloom does not impose a universal `0–1` range, so start near the listed default. A clamp is called out when the implementation applies one.

All 31 built-in effects accept `imageFit`: `'cover'` fills the viewport and may crop the image; `'contain'` shows the whole image and leaves the effect's background visible around it. Defaults differ by effect and are shown below. Most direction options accept `'auto' | 'right' | 'left' | 'down' | 'up'`; `'auto'` follows slider navigation. Effects with additional direction values list them in their own table.

<a id="effect-ink-reveal"></a>
### Ink Reveal (`ink-reveal`) — `InkRevealOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `edgeStrength` | `number` | `0.72` | Ink/contour strength at the reveal edge. |
| `colorLag` | `number` | `0.07` seconds | Delay before revealed pixels reach their final colour. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |
| `debugField` | `boolean` | `false` | Show the procedural reveal field for tuning. |

<a id="effect-melt"></a>
### Melt (`melt`) — `MeltOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `intensity` | `number` | `0.55` | Overall melt/displacement strength. |
| `scale` | `number` | `2.4` | Scale of the displacement field. |
| `aberration` | `number` | `0.35` | RGB separation around refractive edges. |
| `drift` | `number` | `0.4` | Amount of flow and drift. |
| `overlayColor` | `string` | `'#000000'` | Transition overlay colour. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-gummy-squeeze"></a>
### Gummy Squeeze (`gummy-squeeze`) — `GummySqueezeOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; there are no other public tuning options. |

<a id="effect-flow-morph"></a>
### Flow Morph (`flow-morph`) — `FlowMorphOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `strength` | `number` | `1` | Optical-flow distortion strength. |
| `alpha` | `number` | `0.3` | Contribution of the incoming image during the blend. |
| `flowBias` | `number` | `0.8` | Directional bias applied to the flow field. |
| `aberration` | `number` | `0.25` | RGB colour-separation strength. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-rack-focus"></a>
### Rack Focus (`rack-focus`) — `RackFocusOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `blur` | `number` | `0.68` | Maximum defocus around the image handoff. |
| `desaturation` | `number` | `0.42` | Desaturation at peak defocus. |
| `exposureBreath` | `number` | `0.34` | Exposure pulse around the handoff. |
| `grain` | `number` | `0.18` | Temporary film grain while the images are defocused. |
| `focusPoint` | `RackFocusPoint` | `'pointer'` | Focus recovery point: `'pointer'`, `'center'`, or normalized `readonly [x, y]` coordinates. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-liquid-lens"></a>
### Liquid Lens (`liquid-lens`) — `LiquidLensOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `dropCount` | `number` | `9` | Number of independently seeded liquid drops. |
| `refraction` | `number` | `0.58` | Optical displacement inside each liquid surface. |
| `surfaceTension` | `number` | `0.62` | Tightness and visual thickness of the merged liquid boundary. |
| `ripple` | `number` | `0.36` | Travelling surface ripple and caustic response. |
| `dispersion` | `number` | `0.28` | RGB separation around the liquid rim. |
| `mergeSpeed` | `number` | `0.54` | Rate at which separate drops expand into one liquid field. |
| `origin` | `LiquidLensOrigin` | `'pointer'` | Attraction origin: `'pointer'`, `'center'`, or normalized `readonly [x, y]` coordinates. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-frequency-handoff"></a>
### Frequency Handoff (`frequency-handoff`) — `FrequencyHandoffOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `stagger` | `number` | `0.65` | Timing offset between spatial-frequency bands. |
| `order` | `'coarse-first' \| 'fine-first'` | `'coarse-first'` | Whether broad forms or fine detail hand off first. |
| `bloom` | `number` | `0.45` | Glow at the handoff edge. |
| `grain` | `number` | `0.4` | Grain strength. |
| `dispersion` | `number` | `0.5` | Colour-dispersion strength. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-darkroom-develop"></a>
### Darkroom Develop (`darkroom-develop`) — `DarkroomDevelopOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `softness` | `number` | `0.11` | Softness of the developing edge. |
| `safelight` | `number` | `0.65` | Contribution of the darkroom safelight tint. |
| `grain` | `number` | `0.5` | Film-grain strength. |
| `sheen` | `number` | `0.6` | Developing-surface sheen. |
| `direction` | `AxisDirection` | `'auto'` | Sweep direction; `'auto'` follows slider navigation. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-prismatic-glass"></a>
### Prismatic Glass (`prismatic-glass`) — `PrismaticGlassOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `direction` | `PrismaticGlassDirection` | `'auto'` | Direction of the refractive front; the type matches `AxisDirection`. |
| `refraction` | `number` | `0.48` | Optical displacement inside the glass band. |
| `dispersion` | `number` | `0.32` | RGB spectral separation around the refractive edge. |
| `curvature` | `number` | `0.58` | Procedural curvature of the moving front. |
| `edgeGlow` | `number` | `0.46` | Rim-light and caustic-highlight intensity. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-silk-ribbons"></a>
### Silk Ribbons (`silk-ribbons`) — `SilkRibbonsOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `direction` | `SilkRibbonsDirection` | `'auto'` | Exit direction of the old image; the new image enters from the opposite side. Type matches `AxisDirection`. |
| `ribbonCount` | `number` | `44` | Number of independently delayed ribbons. |
| `curl` | `number` | `0.72` | Cross-axis bending and axial flutter strength. |
| `stagger` | `number` | `0.68` | Irregularity in the ribbon timing/order. |
| `sheen` | `number` | `0.62` | Fold shading and warm specular highlight intensity. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-torn-paper"></a>
### Torn Paper (`torn-paper`) — `TornPaperOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `tearSeed` | `number` | `1.4` | Stable seed for the main tear and smaller paper fibers. |
| `direction` | `TornPaperDirection` | `'auto'` | Tear-front direction; type matches `AxisDirection`. |
| `layers` | `number` | `2` | Number of visible paper-core layers around the tear. |
| `fiberWidth` | `number` | `0.52` | Width and maximum reach of procedural paper fibers. |
| `shadowStrength` | `number` | `0.64` | Shadow cast by the lifted paper edge onto the image below. |
| `curl` | `number` | `0.46` | UV displacement and shading on the lifted paper lips. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-burn-through"></a>
### Burn Through (`burn-through`) — `BurnThroughOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `origin` | `BurnOrigin` | `'pointer'` | Burn origin: `'center'`, `'pointer'`, or normalized `readonly [x, y]` coordinates. |
| `burnWidth` | `number` | `0.42` | Width of the scorched transition edge. |
| `charDepth` | `number` | `0.68` | Strength and reach of the carbonized edge. |
| `roughness` | `number` | `0.58` | Irregularity of the advancing burn front. |
| `smoke` | `number` | `0.35` | Procedural smoke above the burn front. |
| `emberColor` | `string` | `'#db764e'` | Main colour used by embers and sparks. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-impasto-stroke"></a>
### Impasto Stroke (`impasto-stroke`) — `ImpastoStrokeOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `bristles` | `number` | `70` | Number of visible brush-bristle details. |
| `wetness` | `number` | `0.65` | Wet-paint body and texture. |
| `gloss` | `number` | `0.7` | Surface-gloss strength. |
| `bead` | `number` | `0.5` | Raised paint buildup along the stroke edge. |
| `direction` | `AxisDirection` | `'auto'` | Brush-stroke sweep direction; `'auto'` follows navigation. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-holo-foil"></a>
### Holo Foil (`holo-foil`) — `HoloFoilOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `foilWidth` | `number` | `0.16` | Width of the moving foil band. |
| `filmDensity` | `number` | `7` | Foil-film texture density. |
| `glitter` | `number` | `0.55` | Glitter-highlight intensity. |
| `refraction` | `number` | `0.4` | Refraction/displacement strength in the foil. |
| `edgeLight` | `number` | `0.6` | Lighting strength along the foil edge. |
| `direction` | `AxisDirection` | `'auto'` | Foil sweep direction; `'auto'` follows navigation. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-lenticular-shift"></a>
### Lenticular Shift (`lenticular-shift`) — `LenticularShiftOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `lensCount` | `number` | `42` | Number of lenticular lens bands. |
| `refraction` | `number` | `0.55` | Refraction strength in the lens bands. |
| `glint` | `number` | `0.7` | Highlight intensity as the bands move. |
| `sheetSoftness` | `number` | `0.22` | Softness of the lens-sheet edges. |
| `direction` | `AxisDirection` | `'auto'` | Band-sweep direction; `'auto'` follows navigation. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-zipper-cloth"></a>
### Zipper Cloth (`zipper-cloth`) — `ZipperClothOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; zipper path and fold geometry are fixed by the effect. |

<a id="effect-postcard-relay"></a>
### Postcard Relay (`postcard-relay`) — `PostcardRelayOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; card movement is fixed by the effect. |

<a id="effect-memory-mosaic"></a>
### Memory Mosaic (`memory-mosaic`) — `MemoryMosaicOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; mosaic-grid layout is fixed by the effect. |

<a id="effect-iris-shutter"></a>
### Iris Shutter (`iris-shutter`) — `IrisShutterOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; shutter-blade count and motion are fixed by the effect. |

<a id="effect-archive-seal"></a>
### Archive Seal (`archive-seal`) — `ArchiveSealOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; seal artwork and stamp motion are fixed by the effect. |

<a id="effect-contact-sheet"></a>
### Contact Sheet (`contact-sheet`) — `ContactSheetOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; contact-sheet layout is fixed by the effect. |

<a id="effect-type-aperture"></a>
### Type Aperture (`type-aperture`) — `TypeApertureOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `word` | `string` | `'NEXT'` | Text used as the aperture mask. |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode. |

<a id="effect-particle-shift"></a>
### Particle Shift (`particle-shift`) — `ParticleShiftOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `particleCount` | `number` | `206976` | Number of particles; higher counts need more GPU resources. |
| `particleSize` | `number` | `1` | Base particle size. |
| `turbulence` | `number` | `1` | Turbulence applied to particle motion. |
| `exitDirection` | `ParticleExitDirection \| 'auto'` | `'right'` | Old-image exit direction: `right`, `left`, `up`, `down`, or `auto`. |
| `enterDirection` | `ParticleEnterDirection` | Opposite of `exitDirection` when omitted | New-image entry direction: `right`, `left`, `top`, or `bottom`. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-chromatic-dust"></a>
### Chromatic Dust (`chromatic-dust`) — `ChromaticDustOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `crystalCount` | `number` | `30000` | Number of coloured dust crystals. |
| `crystalSize` | `number` | `1.45` | Base crystal size. |
| `density` | `number` | `0.78` | Spatial density of the crystals. |
| `turbulence` | `number` | `0.62` | Turbulence applied to crystal motion. |
| `dispersion` | `number` | `0.56` | Colour-dispersion strength. |
| `direction` | `ChromaticDustDirection` | `'auto'` | `'auto'`, `'right'`, `'left'`, or `'radial'`. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-fiber-flow"></a>
### Fiber Flow (`fiber-flow`) — `FiberFlowOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `strandCount` | `number` | `520` | Number of fiber strands. |
| `segmentsPerStrand` | `number` | `64` | Number of segments in each strand. |
| `width` | `number` | `1.55` | Fiber width. |
| `density` | `number` | `0.66` | Fiber coverage density. |
| `curl` | `number` | `0.6` | Amount of fiber curvature. |
| `glow` | `number` | `0.64` | Glow around the fibers. |
| `direction` | `FiberFlowDirection` | `'auto'` | `'auto'`, `'right'`, `'left'`, or `'down'`. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-meteor-wake"></a>
### Meteor Wake (`meteor-wake`) — `MeteorWakeOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `spread` | `number` | `0.66` | Spread of the meteor wake. |
| `turbulence` | `number` | `0.44` | Turbulence applied to wake particles. |
| `glow` | `number` | `0.68` | Glow intensity of meteors and starlight. |
| `afterglow` | `number` | `0.58` | Persistence/intensity of the fading wake. |
| `particleCount` | `number` | Device-dependent: `32768` for coarse-pointer devices or `deviceMemory <= 4`; otherwise `65536` | Number of star particles; higher counts need more GPU resources. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-depth-flip"></a>
### Depth Flip (`depth-flip`) — `DepthFlipOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `depth` | `number` | `0.72` | Depth displacement during the flip. |
| `blur` | `number` | `0.72` | Blur as the image moves through screen depth. |
| `stagger` | `number` | `0.18` | Timing offset between regions of the image. |
| `perspective` | `number` | `2.15` | Perspective strength of the flip. |
| `direction` | `DepthFlipDirection` | `'auto'` | `'auto'`, `'right'`, `'left'`, `'bottom'`, or `'top'`. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-contour-reveal"></a>
### Contour Reveal (`contour-reveal`) — `ContourRevealOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `levels` | `number` | `9` | Number of contour levels. |
| `lineInk` | `number` | `0.85` | Strength of the contour ink lines. |
| `relief` | `number` | `0.55` | Shading strength of the terrain relief. |
| `fillLag` | `number` | `0.12` | Delay of solid image fill behind the contour lines. |
| `directionBias` | `number` | `0.35` | Bias of the reveal field along the sweep direction. |
| `direction` | `AxisDirection` | `'auto'` | Contour sweep direction; `'auto'` follows navigation. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-drowsy-blinds"></a>
### Drowsy Blinds (`drowsy-blinds`) — `DrowsyBlindsOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode; the effect uses a fixed 10-blind layout and exposes no other options. |

<a id="effect-misregistration"></a>
### Misregistration (`misregistration`) — `MisregistrationOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `plateSpread` | `number` | `0.72` | Offset distance between the RGB print plates. |
| `halftoneScale` | `number` | `155` | Density of the halftone grid. |
| `paperTint` | `string` | `'#eee7d8'` | Paper colour revealed through the temporary halftone pattern. |
| `punch` | `number` | `0.46` | Scale-punch strength when the print plates register at the end. |
| `imageFit` | `VaryloomImageFit` | `'cover'` | Image fitting mode. |

<a id="effect-vortex-portal"></a>
### Vortex Portal (`vortex-portal`) — `VortexPortalOptions`

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `twist` | `number` | `0.78` | Vortex distortion strength; clamped to a minimum of `0`. |
| `originX` | `number` | `0.54` | Normalized horizontal vortex centre; clamped to `[0.05, 0.95]`. |
| `originY` | `number` | `0.49` | Normalized vertical vortex centre; clamped to `[0.05, 0.95]`. |
| `spinDirection` | `-1 \| 1` | `1` | Spin direction; `-1` and `1` rotate in opposite directions. |
| `imageFit` | `VaryloomImageFit` | `'contain'` | Image fitting mode. |

Each effect's option interface can be imported separately. `createVaryloom` and React props currently type `effectOptions` as a generic record; use `satisfies` to check the fields at the call site:

```ts
import type { LiquidLensOptions } from 'varyloom';

const liquidOptions = {
  dropCount: 12,
  origin: 'center',
  imageFit: 'contain',
} satisfies LiquidLensOptions;

await slider.setEffect('liquid-lens', liquidOptions);
```

## Controller

`Varyloom<TData>` implements `VaryloomController<TData>`.

| Member | Behavior |
| --- | --- |
| `ready: Promise<void>` | Resolves when initial images and effect are ready; rejects on initialization failure. |
| `currentIndex: number` | Committed item index; changes at the end of a completed transition. |
| `effect: TransitionName` | Active effect name, which may be the fallback rather than the requested name. |
| `isTransitioning: boolean` | True while a normal navigation is preparing or animating. |
| `next(): void`, `prev(): void` | Navigate relative to the current target if already transitioning, otherwise the current item. |
| `goTo(index: number): void` | Navigate to an index; wraps if `loop` is true, otherwise ignores out-of-range indices. |
| `seek(progress: number): void` | Clamp progress to `[0, 1]`; if idle, begin a transition to the next item. Reaching `1` commits it. Direct seeking does not emit `progress`. |
| `play(): void` | Resume scheduling autoplay when `autoplay` is enabled. It does not set `autoplay: true`. |
| `pause(): void` | Suspend autoplay scheduling; it does not stop an active transition. |
| `setEffect(name, options?): Promise<void>` | After readiness, mount the requested effect with supplied effect options (default `{}`). Await this to handle unsupported or initialization errors. |
| `setOptions(options): void` | Update non-item, non-registry options. See the lifecycle note below. |
| `on(name, listener): () => void` | Subscribe to a typed controller event; call the returned function to unsubscribe. These are controller callbacks, not DOM events. |
| `destroy(): void` | Idempotently stop timers/animation, disconnect resize and input handlers, destroy the effect, release owned bitmaps, and remove the controller's host. |

Navigation requested during an active transition stores a pending target; the latest request replaces the previous pending target and starts after the current transition commits. `goTo(currentIndex)` does nothing when idle. When `loop` is false, autoplay reaches the last item and further `next()` calls have no effect.

`setOptions` is a shallow option update. An effect-name change calls `setEffect` internally without returning its Promise; use `await setEffect(...)` when you need to catch a mount failure. Changing `effectOptions` without changing the effect updates the active option record for subsequent renders but does not call `init` again. `items` and `registry` cannot be updated through `setOptions`; `startIndex`, `crossOrigin`, and `preload` do not reload images or reset the current index. `dpr` is applied on a later resize or effect mount, not by an immediate resize call. `setOptions({ effect: ... })` passes only the supplied `effectOptions` (or `{}`) into the new effect mount.

Reduced-motion preference is read when the controller is constructed. When `prefers-reduced-motion: reduce` matches, tween duration is capped at `0.25` seconds; the effect still animates. Preference changes during a controller's lifetime are not observed.

## Events

```ts
const unsubscribe = slider.on('indexchange', ({ index, item }) => {
  console.log(index, item.data);
});

unsubscribe();
```

| Event | Payload | When emitted |
| --- | --- | --- |
| `ready` | `{ effect: TransitionName; index: number }` | Initial images and effect have mounted and the render loop has been scheduled. |
| `transitionstart` | `{ from: number; to: number; direction: -1 \| 1 }` | Navigation starts, or drag/seek opens a transition. |
| `progress` | `{ from: number; to: number; progress: number }` | GSAP tween updates; direct drag/seek assignments do not emit it. |
| `indexchange` | `{ index: number; item: VaryloomItem<TData> }` | A transition commits. |
| `transitionend` | `{ index: number }` | Immediately after `indexchange` on commit; cancelled drags do not emit it. |
| `effectchange` | `{ effect: TransitionName; requestedEffect: TransitionName }` | A definition finishes mounting, including the initial mount. `effect` is the actual mounted name. |
| `fallback` | `{ requestedEffect: TransitionName; fallbackEffect: TransitionName }` | The requested definition's `supported()` returned false and an eligible fallback was selected, before its mount. |
| `error` | `{ error: Error }` | Initialization failures, transition preparation/rejected render Promises, or an effect's `reportError` call. Not every thrown error is converted to an event. |
| `destroy` | `{}` | During `destroy()`, before listeners are cleared. |

The usual completed-navigation sequence is `transitionstart` → zero or more `progress` events → `indexchange` → `transitionend`. A failed initial mount rejects `ready`; a failed `setEffect` rejects its returned Promise. Listener callbacks are invoked synchronously by the controller and are not isolated from exceptions thrown by application code.

## React component

`VaryloomSlider` is exported from `varyloom/react`. `VaryloomSliderProps<TData>` combines `VaryloomOptions<TData>` with ordinary `<div>` HTML attributes, except for conflicting `onError`, `draggable`, `onTransitionStart`, and `onTransitionEnd` attributes. The component renders a `<div>` and defaults its inline style to `position: relative; width: 100%; height: 100%`; your `style` can override these values. Its parent still needs a meaningful size.

```tsx
import { VaryloomSlider } from 'varyloom/react';

const items = [
  { image: '/images/first.jpg', alt: 'First image' },
  { image: '/images/second.jpg', alt: 'Second image' },
];

function Gallery() {
  return (
    <div style={{ width: 800, height: 500 }}>
      <VaryloomSlider
        items={items}
        effect="melt"
        onReady={(controller) => console.log(controller.effect)}
        onIndexChange={({ index }) => console.log(index)}
      />
    </div>
  );
}
```

Keep the `items` array in a stable variable or memoize it to avoid recreating the controller on each render.

| Callback / ref | Argument |
| --- | --- |
| `onReady` | `VaryloomController<TData>` after `createVaryloom` resolves. |
| `onIndexChange` | `indexchange` payload. |
| `onTransitionStart` | `transitionstart` payload. |
| `onTransitionEnd` | `transitionend` payload. |
| `onEffectChange` | `effectchange` payload. |
| `onFallback` | `fallback` payload. |
| `onError` | An `Error`, unwrapped from a controller `error` event or initial creation rejection. |
| `ref` | Controller after readiness; reset to `null` on cleanup. |

There is no `onProgress` prop; use `controller.on('progress', ...)` after `onReady` or via the ref. The component subscribes to controller events **after** `createVaryloom` resolves, so its `onEffectChange` and `onFallback` callbacks do not receive events from the initial mount. `onReady` and the ref expose the active effect and index.

Changing the `items` array reference, `registry`, or `startIndex` destroys and recreates the controller. Other Varyloom option prop changes call `setOptions` on the existing controller. Keep `items` stable across renders unless recreation is intended. The component destroys the controller on unmount; changes to callback props alone use the latest callback without recreation.

## Registry and custom effects

`TransitionRegistry` has `register(definition)`, `replace(definition)`, `get(name)`, `has(name)`, `unregister(name)`, `list()`, and `clone()`. `register` throws on a duplicate or empty name; `replace` overwrites an existing name. `clone` copies the definitions into a new registry, not the effect instances. `defineTransition(definition)` returns the same definition for typing. `registerTransition(definition)` replaces the definition in the global registry and returns an unregister function; that function removes the name only while the registered object is still current. It does not restore a previous definition.

To scope effects to one slider, pass a `TransitionRegistry` as `options.registry`. A custom registry must include the selected `effect` and any configured `fallbackEffect`. `builtInTransitions` is the ordered array of the 31 built-in definitions; you can register them in a scoped registry. The `TransitionRegistryLike` option contract itself requires only `get(name)` and `list()`.

```ts
import {
  TransitionRegistry,
  builtInTransitions,
  defineTransition,
} from 'varyloom';

const registry = new TransitionRegistry();
builtInTransitions.forEach((definition) => registry.register(definition));

registry.register(defineTransition({
  name: 'my-transition',
  backend: 'custom',
  defaults: { color: '#fff' },
  create: () => {
    const canvas = document.createElement('canvas');
    return {
      canvas,
      init({ host }) { host.appendChild(canvas); },
      prepare(fromIndex, toIndex, direction) {},
      resize(width, height, dpr) {},
      render(frame) {},
      destroy() { canvas.remove(); },
    };
  },
}));
```

`TransitionDefinition<TData>` requires `name: TransitionName`, `backend: 'webgl2' | 'webgpu' | 'ogl' | 'custom'`, and `create(): TransitionEffect<TData>`. The backend field is descriptive metadata; the controller uses `supported()` to decide compatibility, not `backend`. Optional `defaults` are shallow-merged with requested `effectOptions`. Optional `supported(): boolean | Promise<boolean>` is called before mounting. Optional `phaseEasing` overrides the controller's easing for the progress tween; use `'none'` for linear simulation time.

`TransitionEffect<TData>` must expose `canvas: HTMLCanvasElement` and these methods:

| Method / property | Contract |
| --- | --- |
| `init(context): void \| Promise<void>` | Initialize with the host, all loaded items, width, height, DPR, merged options, and `reportError(error)`. Append whatever DOM the effect needs to `context.host`. |
| `prepare(fromIndex, toIndex, direction): void \| Promise<void>` | Prepare a source/target pair. Called on initial mount with the same index twice, then before transitions and after completion/cancellation. |
| `resize(width, height, dpr): void` | Respond to initial mount and container resize. |
| `render(frame): void \| Promise<void>` | Draw the current frame. Rejected render Promises emit `error`; synchronous throws are not caught by the render loop. |
| `destroy(): void` | Release effect-owned DOM and GPU resources when replaced or destroyed. |
| `continuous?: boolean` | If true, request rendering every animation frame even while idle; otherwise render when dirty or transitioning. |

`LoadedImage<TData>` adds `source: HTMLImageElement | ImageBitmap`, `width`, `height`, and `release()` to the original `VaryloomItem<TData>`. These loaded objects are given to the effect during `init` and belong to the controller; custom effects should not release them.

`TransitionFrame` contains `progress` (normally moving from `0` to `1`; a custom GSAP ease can overshoot), `time` (seconds since initialization), `delta` (seconds between rendered frames, clamped by the controller), `duration`, `direction` (`-1` or `1`), `active`, `pointer: { x, y }`, and merged `options`. The pointer starts at `{ x: 0.5, y: 0.5 }` and updates on pointer down; its `y` coordinate increases upward. `active` is true while a transition is animating. Custom effects can report recoverable errors with `context.reportError(error)`.

Fallback is attempted only when the requested definition exists and its `supported()` returns false. An unknown effect, failed `supported()` call, failed `create`/`init`/`prepare`, or failed graphics initialization is not automatically replaced by the fallback. If no usable fallback is configured, effect mounting fails. A built-in capability test may only check whether an API is exposed, so confirm actual context/device creation on target browsers.

## Built-in names and backends

Each name below is a `BuiltInTransitionName`; the matching TypeScript option interface is exported from `varyloom` (for example, `InkRevealOptions` and `ParticleShiftOptions`). Each definition is also exported as a camel-case `*Transition` constant.

| Backend | Effect names |
| --- | --- |
| WebGPU | `particle-shift`, `chromatic-dust`, `fiber-flow`, `meteor-wake` |
| OGL / WebGL | `melt` |
| Custom DOM/canvas | `drowsy-blinds`, `postcard-relay`, `type-aperture`, `archive-seal`, `contact-sheet`, `memory-mosaic`, `iris-shutter` |
| WebGL2 | `ink-reveal`, `prismatic-glass`, `silk-ribbons`, `misregistration`, `burn-through`, `rack-focus`, `liquid-lens`, `torn-paper`, `frequency-handoff`, `flow-morph`, `darkroom-develop`, `impasto-stroke`, `lenticular-shift`, `holo-foil`, `contour-reveal`, `depth-flip`, `gummy-squeeze`, `zipper-cloth`, `vortex-portal` |

WebGPU definitions currently check for `navigator.gpu`; WebGL2 definitions check for `WebGL2RenderingContext`; `melt` checks for `WebGLRenderingContext`. These checks do not guarantee that a device, context, shader, or texture can be created successfully.
