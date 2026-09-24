# 更新记录

[English](./CHANGELOG.md) · 简体中文

这里记录 Varyloom 的重要变更。未发布部分尚未包含在当前 npm 包中。

## 未发布

### 修复

- 初始化失败时释放控制器资源，并回收取消之后才完成加载的自有图片资源。

### 网站与文档

- 新增独立的 GitHub Pages 演示站、带类型的 React 与原生 JavaScript 示例，以及效果 API 直达入口。
- 演示画面离屏时销毁控制器，重新可见时恢复此前选中的图片。

## 0.1.0 — 2026-09-24

已发布到 [npm](https://www.npmjs.com/package/varyloom/v/0.1.0)。对应源码提交：[`51ed254`](https://github.com/nanfengw0w/varyloom/commit/51ed254f39d8c5e49b31bbbfeacd3d02708f0298)，版本标签：[`v0.1.0`](https://github.com/nanfengw0w/varyloom/releases/tag/v0.1.0)。

### 新增

- 面向 JavaScript 和 TypeScript 的统一图片转场控制器，以及可选的 React 组件。
- 31 种内置转场，涵盖图像显影、材质、平面设计、粒子和空间效果。
- 用于增加自定义效果的转场注册表与生命周期接口。
- 图片切换、自动播放、拖动、键盘操作、事件、响应式尺寸调整、图片适配和资源清理。
- 基于 WebGL、WebGL2 和 WebGPU 的效果；能力检查判定所选效果不受支持时可配置回退效果。
- TypeScript 类型声明与 MIT 许可证。
