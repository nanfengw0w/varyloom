# Changelog

English · [简体中文](./CHANGELOG.zh-CN.md)

All notable changes to Varyloom are recorded here. Unreleased changes are not included in the current npm package.

## Unreleased

### Fixed

- Release controller resources when initialization fails, including owned images that finish loading after cancellation.

### Website and documentation

- Add the independent GitHub Pages showcase, typed React and vanilla JavaScript examples, and direct API links.
- Destroy offscreen demo controllers and restore the selected image when the preview becomes visible again.

## 0.1.0 — 2026-09-24

Published on [npm](https://www.npmjs.com/package/varyloom/v/0.1.0). Source: [`51ed254`](https://github.com/nanfengw0w/varyloom/commit/51ed254f39d8c5e49b31bbbfeacd3d02708f0298), tagged [`v0.1.0`](https://github.com/nanfengw0w/varyloom/releases/tag/v0.1.0).

### Added

- A unified image-transition controller for JavaScript and TypeScript, plus an optional React component.
- 31 built-in transitions, spanning image reveals, material effects, graphic transitions, particles, and spatial effects.
- A transition registry and lifecycle interface for adding custom effects.
- Navigation, autoplay, dragging, keyboard controls, events, responsive resizing, image fitting, and resource cleanup.
- WebGL, WebGL2, and WebGPU effects with a configurable fallback when capability checking reports an effect as unsupported.
- TypeScript declarations and an MIT license.
