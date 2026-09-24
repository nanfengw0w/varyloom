# API 接口文档

[English](./API.md) · [项目说明](../README.zh-CN.md) · [npm 包](https://www.npmjs.com/package/varyloom)

Varyloom 已发布为 [`varyloom`](https://www.npmjs.com/package/varyloom)。本文说明当前已发布包的接口。

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

## 内置效果参数

下面按效果分别列出可传给 `effectOptions` 或 `setEffect(name, options)` 的字段。表中的默认值来自对应的转场定义；标为“无”的字段不会被该效果读取。数值参数的含义和尺度因效果而异，库不会为所有数值统一规定 `0–1` 范围，请优先从默认值附近调整。只有代码明确钳制的字段会在说明中标出。

`imageFit` 是所有 31 种内置效果共同支持的字段：`'cover'` 按视口填满图片（可能裁切），`'contain'` 完整显示图片（视口剩余处显示效果自身的底色）。各效果默认值不同，见下表。多数方向参数接受 `'auto' | 'right' | 'left' | 'down' | 'up'`；`'auto'` 跟随上一张到下一张的导航方向。效果若使用其他方向值，会在对应表中列出。

<a id="effect-ink-reveal"></a>
### Ink Reveal (`ink-reveal`) — `InkRevealOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `edgeStrength` | `number` | `0.72` | 显影边缘的墨迹/轮廓强度。 |
| `colorLag` | `number` | `0.07` 秒 | 像素显现后到达最终颜色的延迟。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |
| `debugField` | `boolean` | `false` | 显示程序化显影场，供调试参数使用。 |

<a id="effect-melt"></a>
### Melt (`melt`) — `MeltOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `intensity` | `number` | `0.55` | 融化/位移转场的总体强度。 |
| `scale` | `number` | `2.4` | 位移场的尺度。 |
| `aberration` | `number` | `0.35` | 边缘 RGB 色散强度。 |
| `drift` | `number` | `0.4` | 画面流动与漂移幅度。 |
| `overlayColor` | `string` | `'#000000'` | 转场叠加色。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-gummy-squeeze"></a>
### Gummy Squeeze (`gummy-squeeze`) — `GummySqueezeOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；该效果没有其他公开调节字段。 |

<a id="effect-flow-morph"></a>
### Flow Morph (`flow-morph`) — `FlowMorphOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `strength` | `number` | `1` | 光流形变强度。 |
| `alpha` | `number` | `0.3` | 新图参与混合的强度。 |
| `flowBias` | `number` | `0.8` | 光流方向/偏向影响。 |
| `aberration` | `number` | `0.25` | RGB 色差强度。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-rack-focus"></a>
### Rack Focus (`rack-focus`) — `RackFocusOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `blur` | `number` | `0.68` | 图片交接时的最大失焦程度。 |
| `desaturation` | `number` | `0.42` | 失焦峰值时的去饱和强度。 |
| `exposureBreath` | `number` | `0.34` | 交接过程中的曝光呼吸幅度。 |
| `grain` | `number` | `0.18` | 失焦期间的临时胶片颗粒强度。 |
| `focusPoint` | `RackFocusPoint` | `'pointer'` | 对焦恢复位置：`'pointer'`、`'center'` 或归一化坐标 `readonly [x, y]`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-liquid-lens"></a>
### Liquid Lens (`liquid-lens`) — `LiquidLensOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `dropCount` | `number` | `9` | 独立液滴数量。 |
| `refraction` | `number` | `0.58` | 液滴内部的光学位移强度。 |
| `surfaceTension` | `number` | `0.62` | 液滴合并边界的紧致度与厚度。 |
| `ripple` | `number` | `0.36` | 表面波纹和焦散变化强度。 |
| `dispersion` | `number` | `0.28` | 液滴边缘 RGB 色散。 |
| `mergeSpeed` | `number` | `0.54` | 独立液滴扩张并连成液体区域的速度。 |
| `origin` | `LiquidLensOrigin` | `'pointer'` | 液滴吸引中心：`'pointer'`、`'center'` 或归一化坐标 `readonly [x, y]`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-frequency-handoff"></a>
### Frequency Handoff (`frequency-handoff`) — `FrequencyHandoffOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `stagger` | `number` | `0.65` | 不同空间频率层之间的错开程度。 |
| `order` | `'coarse-first' \| 'fine-first'` | `'coarse-first'` | 先交接大尺度轮廓还是细节。 |
| `bloom` | `number` | `0.45` | 交接边缘的辉光强度。 |
| `grain` | `number` | `0.4` | 颗粒纹理强度。 |
| `dispersion` | `number` | `0.5` | 色散强度。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-darkroom-develop"></a>
### Darkroom Develop (`darkroom-develop`) — `DarkroomDevelopOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `softness` | `number` | `0.11` | 显影边缘的柔和程度。 |
| `safelight` | `number` | `0.65` | 暗房安全灯色调的参与强度。 |
| `grain` | `number` | `0.5` | 胶片颗粒强度。 |
| `sheen` | `number` | `0.6` | 显影表面的光泽强度。 |
| `direction` | `AxisDirection` | `'auto'` | 显影扫过方向；`'auto'` 跟随导航方向。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-prismatic-glass"></a>
### Prismatic Glass (`prismatic-glass`) — `PrismaticGlassOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `direction` | `PrismaticGlassDirection` | `'auto'` | 折射前沿移动方向；支持 `AxisDirection`。 |
| `refraction` | `number` | `0.48` | 玻璃带内部的光学位移强度。 |
| `dispersion` | `number` | `0.32` | 折射边缘的 RGB 光谱分离强度。 |
| `curvature` | `number` | `0.58` | 移动前沿的程序化弯曲程度。 |
| `edgeGlow` | `number` | `0.46` | 边缘光和焦散高光强度。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-silk-ribbons"></a>
### Silk Ribbons (`silk-ribbons`) — `SilkRibbonsOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `direction` | `SilkRibbonsDirection` | `'auto'` | 旧图离场方向，新图从相反方向进入；支持 `AxisDirection`。 |
| `ribbonCount` | `number` | `44` | 独立绸带数量。 |
| `curl` | `number` | `0.72` | 绸带横向弯曲和沿长度抖动强度。 |
| `stagger` | `number` | `0.68` | 各绸带运动顺序的错开/随机程度。 |
| `sheen` | `number` | `0.62` | 折面阴影和暖色镜面高光强度。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-torn-paper"></a>
### Torn Paper (`torn-paper`) — `TornPaperOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `tearSeed` | `number` | `1.4` | 控制主撕裂线和细小纸纤维的稳定随机种子。 |
| `direction` | `TornPaperDirection` | `'auto'` | 撕裂前进方向；支持 `AxisDirection`。 |
| `layers` | `number` | `2` | 撕裂边缘可见的纸张核心层数。 |
| `fiberWidth` | `number` | `0.52` | 程序化纸纤维的宽度和最大延伸范围。 |
| `shadowStrength` | `number` | `0.64` | 撕起纸边投射到下层图片上的阴影强度。 |
| `curl` | `number` | `0.46` | 翘起纸边的 UV 位移和明暗变化。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-burn-through"></a>
### Burn Through (`burn-through`) — `BurnThroughOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `origin` | `BurnOrigin` | `'pointer'` | 起燃点：`'center'`、`'pointer'` 或归一化坐标 `readonly [x, y]`。 |
| `burnWidth` | `number` | `0.42` | 焦黑转场边缘的宽度。 |
| `charDepth` | `number` | `0.68` | 碳化边缘的强度与延伸范围。 |
| `roughness` | `number` | `0.58` | 燃烧前沿的不规则程度。 |
| `smoke` | `number` | `0.35` | 燃烧前沿上方的程序化烟雾量。 |
| `emberColor` | `string` | `'#db764e'` | 余烬和火星的主颜色。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-impasto-stroke"></a>
### Impasto Stroke (`impasto-stroke`) — `ImpastoStrokeOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `bristles` | `number` | `70` | 笔刷刷毛细节数量。 |
| `wetness` | `number` | `0.65` | 湿画颜料的厚重感。 |
| `gloss` | `number` | `0.7` | 颜料表面光泽强度。 |
| `bead` | `number` | `0.5` | 颜料边缘堆积/凸起感。 |
| `direction` | `AxisDirection` | `'auto'` | 笔触扫过方向；`'auto'` 跟随导航方向。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-holo-foil"></a>
### Holo Foil (`holo-foil`) — `HoloFoilOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `foilWidth` | `number` | `0.16` | 移动箔膜带的宽度。 |
| `filmDensity` | `number` | `7` | 箔膜纹理密度。 |
| `glitter` | `number` | `0.55` | 闪粉高光强度。 |
| `refraction` | `number` | `0.4` | 箔膜的折射/位移强度。 |
| `edgeLight` | `number` | `0.6` | 箔膜边缘照明强度。 |
| `direction` | `AxisDirection` | `'auto'` | 箔膜移动方向；`'auto'` 跟随导航方向。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-lenticular-shift"></a>
### Lenticular Shift (`lenticular-shift`) — `LenticularShiftOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `lensCount` | `number` | `42` | 透镜条纹数量。 |
| `refraction` | `number` | `0.55` | 条纹透镜的折射强度。 |
| `glint` | `number` | `0.7` | 条纹移动时的高光强度。 |
| `sheetSoftness` | `number` | `0.22` | 透镜片边缘的柔和程度。 |
| `direction` | `AxisDirection` | `'auto'` | 条纹扫过方向；`'auto'` 跟随导航方向。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-zipper-cloth"></a>
### Zipper Cloth (`zipper-cloth`) — `ZipperClothOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；拉链路径和褶皱形状由效果固定。 |

<a id="effect-postcard-relay"></a>
### Postcard Relay (`postcard-relay`) — `PostcardRelayOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 明信片图片适配方式；卡片运动节奏由效果固定。 |

<a id="effect-memory-mosaic"></a>
### Memory Mosaic (`memory-mosaic`) — `MemoryMosaicOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；马赛克网格布局由效果固定。 |

<a id="effect-iris-shutter"></a>
### Iris Shutter (`iris-shutter`) — `IrisShutterOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；光圈叶片数量和运动由效果固定。 |

<a id="effect-archive-seal"></a>
### Archive Seal (`archive-seal`) — `ArchiveSealOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；印章图形和压印运动由效果固定。 |

<a id="effect-contact-sheet"></a>
### Contact Sheet (`contact-sheet`) — `ContactSheetOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；联系表格布局由效果固定。 |

<a id="effect-type-aperture"></a>
### Type Aperture (`type-aperture`) — `TypeApertureOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `word` | `string` | `'NEXT'` | 用作开窗遮罩的文字。 |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式。 |

<a id="effect-particle-shift"></a>
### Particle Shift (`particle-shift`) — `ParticleShiftOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `particleCount` | `number` | `206976` | 粒子数量；较大的数量需要更多 GPU 资源。 |
| `particleSize` | `number` | `1` | 粒子基础尺寸。 |
| `turbulence` | `number` | `1` | 粒子运动的扰动强度。 |
| `exitDirection` | `ParticleExitDirection \| 'auto'` | `'right'` | 旧图粒子离场方向；支持 `right`、`left`、`up`、`down` 和 `auto`。 |
| `enterDirection` | `ParticleEnterDirection` | 未设置时取离场方向的反方向 | 新图粒子的进入方向；支持 `right`、`left`、`top`、`bottom`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-chromatic-dust"></a>
### Chromatic Dust (`chromatic-dust`) — `ChromaticDustOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `crystalCount` | `number` | `30000` | 彩色晶尘粒子数量。 |
| `crystalSize` | `number` | `1.45` | 晶尘基础尺寸。 |
| `density` | `number` | `0.78` | 晶尘的分布密度。 |
| `turbulence` | `number` | `0.62` | 晶尘运动扰动强度。 |
| `dispersion` | `number` | `0.56` | 色彩分散强度。 |
| `direction` | `ChromaticDustDirection` | `'auto'` | `'auto'`、`'right'`、`'left'` 或 `'radial'`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-fiber-flow"></a>
### Fiber Flow (`fiber-flow`) — `FiberFlowOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `strandCount` | `number` | `520` | 纤维束数量。 |
| `segmentsPerStrand` | `number` | `64` | 每束纤维的线段数。 |
| `width` | `number` | `1.55` | 纤维宽度。 |
| `density` | `number` | `0.66` | 纤维覆盖密度。 |
| `curl` | `number` | `0.6` | 纤维弯曲程度。 |
| `glow` | `number` | `0.64` | 纤维周围的光晕强度。 |
| `direction` | `FiberFlowDirection` | `'auto'` | `'auto'`、`'right'`、`'left'` 或 `'down'`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-meteor-wake"></a>
### Meteor Wake (`meteor-wake`) — `MeteorWakeOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `spread` | `number` | `0.66` | 流星尾迹向周围扩散的幅度。 |
| `turbulence` | `number` | `0.44` | 尾迹粒子的扰动强度。 |
| `glow` | `number` | `0.68` | 流星和星光的辉光强度。 |
| `afterglow` | `number` | `0.58` | 尾迹消散后的余辉强度/持续感。 |
| `particleCount` | `number` | 设备相关：粗指针设备或 `deviceMemory <= 4` 时 `32768`，其他设备 `65536` | 星光粒子数量；较大的数量需要更多 GPU 资源。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-depth-flip"></a>
### Depth Flip (`depth-flip`) — `DepthFlipOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `depth` | `number` | `0.72` | 翻转过程中的纵深位移强度。 |
| `blur` | `number` | `0.72` | 进入/离开屏幕纵深时的虚化强度。 |
| `stagger` | `number` | `0.18` | 画面区域开始翻转的时间错开量。 |
| `perspective` | `number` | `2.15` | 透视翻转强度。 |
| `direction` | `DepthFlipDirection` | `'auto'` | `'auto'`、`'right'`、`'left'`、`'bottom'` 或 `'top'`。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-contour-reveal"></a>
### Contour Reveal (`contour-reveal`) — `ContourRevealOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `levels` | `number` | `9` | 等高线层级数量。 |
| `lineInk` | `number` | `0.85` | 等高线墨线强度。 |
| `relief` | `number` | `0.55` | 地形浮雕明暗强度。 |
| `fillLag` | `number` | `0.12` | 实色显现相对轮廓线的延迟。 |
| `directionBias` | `number` | `0.35` | 显影场沿扫过方向的偏置量。 |
| `direction` | `AxisDirection` | `'auto'` | 等高线扫过方向；`'auto'` 跟随导航方向。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-drowsy-blinds"></a>
### Drowsy Blinds (`drowsy-blinds`) — `DrowsyBlindsOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式；百叶片数量固定为 10，当前没有其他公开参数。 |

<a id="effect-misregistration"></a>
### Misregistration (`misregistration`) — `MisregistrationOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `plateSpread` | `number` | `0.72` | RGB 印版错位距离。 |
| `halftoneScale` | `number` | `155` | 半色调网点网格密度。 |
| `paperTint` | `string` | `'#eee7d8'` | 半色调暂时显露出的纸张颜色。 |
| `punch` | `number` | `0.46` | 结尾套印对齐时的缩放强调强度。 |
| `imageFit` | `VaryloomImageFit` | `'cover'` | 图片适配方式。 |

<a id="effect-vortex-portal"></a>
### Vortex Portal (`vortex-portal`) — `VortexPortalOptions`

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `twist` | `number` | `0.78` | 旋涡扭曲强度；实现中最小钳制为 `0`。 |
| `originX` | `number` | `0.54` | 旋涡中心的归一化横坐标；实现中钳制到 `[0.05, 0.95]`。 |
| `originY` | `number` | `0.49` | 旋涡中心的归一化纵坐标；实现中钳制到 `[0.05, 0.95]`。 |
| `spinDirection` | `-1 \| 1` | `1` | 旋转方向；`-1` 与 `1` 表示相反方向。 |
| `imageFit` | `VaryloomImageFit` | `'contain'` | 图片适配方式。 |

每种效果的参数也可作为对应的 TypeScript 类型单独导入。`createVaryloom` 和 React props 上的 `effectOptions` 目前使用通用记录类型；需要在调用处检查具体效果的字段时，可使用 `satisfies`：

```ts
import type { LiquidLensOptions } from 'varyloom';

const liquidOptions = {
  dropCount: 12,
  origin: 'center',
  imageFit: 'contain',
} satisfies LiquidLensOptions;

await slider.setEffect('liquid-lens', liquidOptions);
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
