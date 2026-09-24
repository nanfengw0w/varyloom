# API reference

[Chinese](./API.zh-CN.md) · [README](../README.md)

> Pre-release: Varyloom is being prepared for its first npm release. The import examples below apply after publication. This reference describes the current source API.

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
