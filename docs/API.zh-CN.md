# API 接口文档

[English](./API.md) · [项目说明](../README.zh-CN.md)

> 尚未发布：Varyloom 正在准备首次 npm 发布。下文的包导入示例适用于发布后。本文记录当前源码中的接口。

Varyloom 在浏览器中运行。容器须是具有可见尺寸的 `HTMLElement`，至少提供两张图片；运行环境还须具备 `ResizeObserver`、`requestAnimationFrame` 等浏览器 API。GPU 效果还需要相应的图形 API。除特别说明外，控制器中的时间单位均为秒。

## 导入入口

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

主入口还导出每个内置效果的定义和相应的 `*Options` 类型，以及 `types.ts` 中的共用类型。`varyloom/transitions` 是内置效果定义及参数类型的导出路径。导入主入口时，31 种内置效果会注册到全局 `transitionRegistry`。

`createVaryloom<TData>(container, options): Promise<Varyloom<TData>>` 创建控制器，图片加载和初始效果挂载完成后才兑现 Promise。`new Varyloom<TData>(container, options)` 会立即返回，其 `ready: Promise<void>` 表示相同的初始化过程。容器不是 `HTMLElement` 或图片项少于两项时，构造函数会同步抛错；异步的 `createVaryloom` 则返回被拒绝的 Promise。资源或初始效果加载失败会使 `ready` 拒绝；若监听器注册得足够早，初始化还会发出 `error` 事件。

```ts
const slider = await createVaryloom(document.querySelector('#slider')!, {
  items: [
    { image: '/images/first.jpg', alt: '第一张图片' },
    { image: '/images/second.jpg', alt: '第二张图片' },
  ],
  effect: 'ink-reveal',
});

slider.next();
slider.destroy();
```

请给容器设置宽度和高度，例如使用 `aspect-ratio`。控制器会在其中创建铺满容器的子元素。`createVaryloom` 返回时，初始 `effectchange` 和 `ready` 事件已经发出；如果需要监听这两个初始事件，应对 `new Varyloom(...)` 返回的实例立即订阅，然后等待 `ready`，或者创建完成后直接读取 `effect` 和 `currentIndex`。

## 图片项与配置

```ts
type VaryloomImageSource = string | Blob | HTMLImageElement | ImageBitmap;

interface VaryloomItem<TData = unknown> {
  image: VaryloomImageSource;
  alt?: string;
  caption?: string;
  data?: TData;
}
```

`image` 为必填项。`alt`、`caption`、`data` 是图片项元数据；`indexchange` 事件会返回原始图片项。Canvas 效果不会自动把 `alt` 渲染成可访问的 `<img>`，需要时请自行提供可访问的图片描述和控制按钮。

| `VaryloomOptions<TData>` 属性 | 默认值 | 实际行为 |
| --- | --- | --- |
| `items: VaryloomItem<TData>[]` | 必填 | 至少两项；初始化期间加载全部图片。 |
| `effect?: TransitionName` | `'ink-reveal'` | 内置或已注册的效果名称。 |
| `duration?: number` | `1.2` | 转场时长；最小钳制为 `0`。 |
| `easing?: string` | `'power2.inOut'` | 进度补间使用的 GSAP 缓动；效果定义中的 `phaseEasing` 优先。 |
| `startIndex?: number` | `0` | 初始索引；即使 `loop` 为 false，也会环绕到有效范围。 |
| `autoplay?: boolean` | `false` | 定时切换到下一张图片。 |
| `autoplayDelay?: number` | `4` | 上一转场完成到下一次自动切换的间隔；最小钳制为 `0.1`。 |
| `loop?: boolean` | `true` | 首尾循环；关闭后，越界的导航调用不起作用。 |
| `draggable?: boolean` | `true` | 开启横向指针拖动。松开时进度大于 `0.4` 则完成切换，否则退回。 |
| `keyboard?: boolean` | `true` | 让内部容器可聚焦，聚焦后响应左右方向键。 |
| `pauseOnHover?: boolean` | `true` | 鼠标进入时清除自动播放计时器，离开时重新安排。 |
| `preload?: 'all'` | `'all'` | 唯一支持的模式；准备就绪之前加载所有图片项。 |
| `crossOrigin?: '' \| 'anonymous' \| 'use-credentials'` | `'anonymous'` | 通过非 `data:`/非 `blob:` URL 创建图片时使用。 |
| `dpr?: number` | `2` | 传给效果的设备像素比上限；配置值最小钳制为 `1`。 |
| `fallbackEffect?: TransitionName \| false` | `'melt'` | 请求效果的 `supported()` 返回不支持时尝试的效果；`false` 表示不回退。 |
| `effectOptions?: Record<string, unknown>` | `{}` | 效果专有参数，与效果定义中的 `defaults` 做浅层合并。 |
| `registry?: TransitionRegistryLike` | `transitionRegistry` | 当前实例使用的注册表，至少要实现 `get(name)` 和 `list()`。 |

实际传给效果的设备像素比是 `min(devicePixelRatio || 1, 配置的 dpr)`。视口宽高以 CSS 像素测量，最小各为 `1`。

对于字符串 URL，若 `crossOrigin` 非空，且 URL 不是 `data:` 或 `blob:`，库会在设置图片 URL **之前**把该值设到新建的 `Image` 对象。已有的 `HTMLImageElement` 保留自己的跨域配置。`Blob` 会通过 `createImageBitmap` 转换；调用方提供的 `ImageBitmap` 直接使用。`destroy()` 只会关闭库自己从 Blob 创建的位图。远端图片服务器仍须返回合适的 CORS 响应头，GPU 才能上传纹理。图片加载、解码、纹理上传与图形上下文创建也都可能分别失败。

所有内置效果均可通过 `effectOptions.imageFit` 使用 `VaryloomImageFit = 'cover' | 'contain'`。每种内置效果的 `*Options` 类型还列出专有参数；控制器的 `effectOptions` 本身刻意采用通用记录类型。例如：

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

## 控制器

`Varyloom<TData>` 实现 `VaryloomController<TData>`。

| 成员 | 行为 |
| --- | --- |
| `ready: Promise<void>` | 初始图片和效果准备完成时兑现；初始化失败时拒绝。 |
| `currentIndex: number` | 已确认切换到的图片索引；转场完成时更新。 |
| `effect: TransitionName` | 当前实际效果名称，可能是回退效果而非请求效果。 |
| `isTransitioning: boolean` | 普通导航正在准备或播放时为 true。 |
| `next(): void`、`prev(): void` | 切换到相邻图片；正在转场时，以当前目标索引为基准。 |
| `goTo(index: number): void` | 切换到指定索引；`loop` 为 true 时环绕，否则忽略越界值。 |
| `seek(progress: number): void` | 将进度钳制到 `[0, 1]`；空闲时向下一张图片开始转场，达到 `1` 时确认切换。直接设置进度不会发出 `progress` 事件。 |
| `play(): void` | `autoplay` 已开启时恢复安排自动播放；不会把 `autoplay` 改为 true。 |
| `pause(): void` | 暂停安排自动播放；不会停止正在进行的转场。 |
| `setEffect(name, options?): Promise<void>` | 就绪后挂载指定效果及参数，参数默认 `{}`；等待此 Promise 可捕获不支持或初始化失败。 |
| `setOptions(options): void` | 更新图片项和注册表以外的配置，限制见下文。 |
| `on(name, listener): () => void` | 订阅带类型的控制器事件；调用返回函数即可取消。它们不是 DOM 事件。 |
| `destroy(): void` | 可重复调用；停止计时器和动画、断开尺寸监听和输入事件、销毁效果、释放自有位图、移除内部容器。 |

在转场过程中发起的导航会保存一个待切换目标；较新的调用会覆盖旧目标，并在当前转场确认完成后启动。空闲时调用 `goTo(currentIndex)` 不起作用。`loop` 为 false 时，自动播放到最后一项后再调用 `next()` 也不会继续切换。

`setOptions` 对配置做浅层更新。改变效果名称会在内部调用 `setEffect`，但不返回它的 Promise；需要处理挂载失败时请直接 `await setEffect(...)`。仅更改 `effectOptions` 会更新后续渲染所用参数，不会再次调用效果的 `init`。`items` 和 `registry` 不能通过 `setOptions` 更新；更新 `startIndex`、`crossOrigin`、`preload` 不会重新加载图片或重置当前索引。更改 `dpr` 不会立即调用 `resize`，它会在后续尺寸变化或效果挂载时生效。`setOptions({ effect: ... })` 向新效果挂载过程只传入本次提供的 `effectOptions`，未提供时传入 `{}`。

控制器在构造时读取一次 `prefers-reduced-motion`。匹配 `reduce` 时，补间时长最多为 `0.25` 秒，效果仍会播放；实例存续期间不会监听偏好变化。

## 事件

```ts
const unsubscribe = slider.on('indexchange', ({ index, item }) => {
  console.log(index, item.data);
});

unsubscribe();
```

| 事件 | 载荷 | 发出时机 |
| --- | --- | --- |
| `ready` | `{ effect: TransitionName; index: number }` | 初始图片与效果挂载完成，并已安排渲染循环。 |
| `transitionstart` | `{ from: number; to: number; direction: -1 \| 1 }` | 导航开始，或拖动/`seek` 开始一个转场。 |
| `progress` | `{ from: number; to: number; progress: number }` | GSAP 补间更新时；直接拖动或 `seek` 赋值不会发出。 |
| `indexchange` | `{ index: number; item: VaryloomItem<TData> }` | 转场确认完成时。 |
| `transitionend` | `{ index: number }` | 确认完成后紧接着 `indexchange` 发出；取消的拖动不会发出。 |
| `effectchange` | `{ effect: TransitionName; requestedEffect: TransitionName }` | 效果定义完成挂载时，含初始挂载。`effect` 是实际挂载的名称。 |
| `fallback` | `{ requestedEffect: TransitionName; fallbackEffect: TransitionName }` | 请求效果的 `supported()` 返回 false，且已选中可用回退效果时，在挂载前发出。 |
| `error` | `{ error: Error }` | 初始化失败、转场准备失败、渲染 Promise 被拒绝，或效果调用 `reportError` 时。并非每一种异常都会转成事件。 |
| `destroy` | `{}` | `destroy()` 期间，在清除监听器之前。 |

普通的成功转场通常按 `transitionstart` → 零个或多个 `progress` → `indexchange` → `transitionend` 的顺序发出事件。初始挂载失败会拒绝 `ready`；`setEffect` 失败会拒绝其返回的 Promise。控制器同步调用应用传入的监听器，应用监听器抛出的异常不会被隔离。

## React 组件

`VaryloomSlider` 从 `varyloom/react` 导出。`VaryloomSliderProps<TData>` 包含 `VaryloomOptions<TData>` 和普通 `<div>` HTML 属性，但排除了与库接口冲突的 `onError`、`draggable`、`onTransitionStart`、`onTransitionEnd` HTML 属性。组件渲染一个 `<div>`；其默认内联样式为 `position: relative; width: 100%; height: 100%`，传入的 `style` 可以覆盖这些值。父元素仍须有明确尺寸。

```tsx
import { VaryloomSlider } from 'varyloom/react';

const items = [
  { image: '/images/first.jpg', alt: '第一张图片' },
  { image: '/images/second.jpg', alt: '第二张图片' },
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

请像示例一样使用引用稳定的 `items` 数组，或使用记忆化，避免每次渲染都重建控制器。

| 回调 / ref | 参数 |
| --- | --- |
| `onReady` | `createVaryloom` 兑现后的 `VaryloomController<TData>`。 |
| `onIndexChange` | `indexchange` 载荷。 |
| `onTransitionStart` | `transitionstart` 载荷。 |
| `onTransitionEnd` | `transitionend` 载荷。 |
| `onEffectChange` | `effectchange` 载荷。 |
| `onFallback` | `fallback` 载荷。 |
| `onError` | 一个 `Error`；来源于控制器的 `error` 事件，或首次创建时的 Promise 拒绝。 |
| `ref` | 就绪后指向控制器，清理时重设为 `null`。 |

没有 `onProgress` 属性；可在 `onReady` 后或通过 ref 调用 `controller.on('progress', ...)`。组件在 `createVaryloom` 兑现 **之后** 才订阅控制器事件，因此首次挂载的 `effectchange` 和 `fallback` 不会触发组件的 `onEffectChange`、`onFallback`。可以从 `onReady` 参数或 ref 读取当前实际效果和索引。

更换 `items` 数组引用、`registry` 或 `startIndex` 会销毁并重建控制器。其他 Varyloom 配置属性变化会调用现有控制器的 `setOptions`。若不想重建，请让 `items` 在多次渲染间保持引用稳定。组件卸载时销毁控制器；仅改变回调属性时会使用新回调，不会重建。

## 注册表与自定义效果

`TransitionRegistry` 提供 `register(definition)`、`replace(definition)`、`get(name)`、`has(name)`、`unregister(name)`、`list()` 和 `clone()`。`register` 遇到重复或空名称会抛错；`replace` 覆盖已有名称。`clone` 把定义复制到新注册表，不复制效果实例。`defineTransition(definition)` 原样返回定义，便于类型推导。`registerTransition(definition)` 在全局注册表中覆盖同名定义，并返回注销函数；只有该对象仍是当前定义时，注销函数才会删除该名称。它不会恢复先前的定义。

通过 `options.registry` 可为单个轮播使用独立注册表。自定义注册表必须包含所选的 `effect`，以及配置了的 `fallbackEffect`。`builtInTransitions` 是按顺序排列的 31 个内置效果定义数组，可用于填充独立注册表。`TransitionRegistryLike` 接口本身只要求 `get(name)` 和 `list()`。

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

`TransitionDefinition<TData>` 必须包含 `name: TransitionName`、`backend: 'webgl2' | 'webgpu' | 'ogl' | 'custom'` 和 `create(): TransitionEffect<TData>`。`backend` 是描述性元数据；控制器通过 `supported()` 判定兼容性，不依据 `backend` 自动检测。可选的 `defaults` 与请求的 `effectOptions` 浅层合并。可选的 `supported(): boolean | Promise<boolean>` 在挂载前调用。可选的 `phaseEasing` 优先于控制器的进度缓动；需要线性模拟时间时可设为 `'none'`。

`TransitionEffect<TData>` 必须暴露 `canvas: HTMLCanvasElement` 和以下方法：

| 方法 / 属性 | 约定 |
| --- | --- |
| `init(context): void \| Promise<void>` | 接收内部容器、全部已加载图片、宽高、DPR、合并后的选项和 `reportError(error)`；效果需自行把所需 DOM 加入 `context.host`。 |
| `prepare(fromIndex, toIndex, direction): void \| Promise<void>` | 准备来源/目标图片；初始挂载时两者为同一索引，后续转场之前及完成/取消后也会调用。 |
| `resize(width, height, dpr): void` | 响应初始挂载和容器尺寸变化。 |
| `render(frame): void \| Promise<void>` | 绘制当前帧。被拒绝的渲染 Promise 会发出 `error`；渲染循环不捕获同步抛出的异常。 |
| `destroy(): void` | 被替换或销毁时释放效果自己的 DOM 和 GPU 资源。 |
| `continuous?: boolean` | 为 true 时，空闲期间也每帧渲染；否则仅在画面变脏或转场期间渲染。 |

`LoadedImage<TData>` 在原始 `VaryloomItem<TData>` 基础上增加了 `source: HTMLImageElement | ImageBitmap`、`width`、`height` 和 `release()`。效果的 `init` 会得到这些对象，其所有权属于控制器；自定义效果不要自行释放。

`TransitionFrame` 包含 `progress`（一般从 `0` 走向 `1`；自定义 GSAP 缓动可能超出该范围）、`time`（初始化以来的秒数）、`delta`（两次渲染之间的秒数，经过控制器钳制）、`duration`、`direction`（`-1` 或 `1`）、`active`、`pointer: { x, y }` 以及合并后的 `options`。指针初始为 `{ x: 0.5, y: 0.5 }`，按下指针时更新；`y` 向上增大。转场动画期间 `active` 为 true。自定义效果可通过 `context.reportError(error)` 报告可恢复错误。

只有请求的效果定义存在且其 `supported()` 返回 false，控制器才会尝试回退。未知效果、`supported()` 调用失败、`create`/`init`/`prepare` 失败，或图形初始化失败，都不会自动替换为回退效果。没有可用的回退配置时，效果挂载失败。内置效果的能力检查有时只检测 API 是否存在，因此还需在目标浏览器验证设备、上下文、着色器和纹理能否真正创建。

## 内置效果名称与后端

下列每个名称均属于 `BuiltInTransitionName`；对应的 TypeScript 参数接口从 `varyloom` 导出，例如 `InkRevealOptions`、`ParticleShiftOptions`。各定义还分别以驼峰命名的 `*Transition` 常量导出。

| 后端 | 效果名称 |
| --- | --- |
| WebGPU | `particle-shift`、`chromatic-dust`、`fiber-flow`、`meteor-wake` |
| OGL / WebGL | `melt` |
| 自定义 DOM/canvas | `drowsy-blinds`、`postcard-relay`、`type-aperture`、`archive-seal`、`contact-sheet`、`memory-mosaic`、`iris-shutter` |
| WebGL2 | `ink-reveal`、`prismatic-glass`、`silk-ribbons`、`misregistration`、`burn-through`、`rack-focus`、`liquid-lens`、`torn-paper`、`frequency-handoff`、`flow-morph`、`darkroom-develop`、`impasto-stroke`、`lenticular-shift`、`holo-foil`、`contour-reveal`、`depth-flip`、`gummy-squeeze`、`zipper-cloth`、`vortex-portal` |

WebGPU 定义目前检查 `navigator.gpu`；WebGL2 定义检查 `WebGL2RenderingContext`；`melt` 检查 `WebGLRenderingContext`。这些检查不能保证设备、上下文、着色器或纹理一定能创建成功。
