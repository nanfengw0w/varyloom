# Varyloom website

The independent bilingual showcase and interactive playground for [Varyloom](https://www.npmjs.com/package/varyloom).

**[Open the website](https://nanfengw0w.github.io/varyloom/?lang=en)** · **[打开中文网站](https://nanfengw0w.github.io/varyloom/?lang=zh)**

This private package installs **varyloom@0.1.0 from npm**. It does not import the library's source tree. Core changes under the repository's Unreleased changelog are not included in these demonstrations until a new npm version is published and deliberately adopted here.

## Develop

Requires Node.js 22.13 or later. Run inside `website/`:

```sh
npm ci
npm run dev
```

Open http://localhost:5173/.

## Verify and build

```sh
npm run typecheck
npm run check:lifecycle
npm run check:examples
npm run build
npm run preview
```

The static preview is at http://127.0.0.1:4178/varyloom/. Both `/` and `/playground/` are exported. The build checks route HTML and the repository asset prefix before succeeding. No application server, database, authentication service, or Cloudflare account is required for deployment.

The Pages workflow publishes `dist/client` on changes to this directory on `main`. It never publishes to npm. Keep `next.config.ts` free of a framework `basePath`: the current Vinext exporter requests routes without that prefix. `sitePath()` and Vite's asset base handle the public `/varyloom/` prefix, and the build creates a directory index for the playground.

## Assets and previews

Photograph sources and font licensing are recorded in [ASSETS.md](./ASSETS.md) and `public/images/sources.json`. The three animated README previews in `../docs/media/` were captured from the published package running in this website. The website, photographs and preview GIFs are excluded from the core npm package.
