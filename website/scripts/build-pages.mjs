import {readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

process.env.GITHUB_PAGES = 'true';
process.env.NEXT_PUBLIC_BASE_PATH = '/varyloom';
const root = fileURLToPath(new URL('../', import.meta.url));
const finish = code => {
  process.exitCode = code;
  if (code !== 0) return;
  const client = path.join(root, 'dist/client');
  for (const page of ['index.html', 'playground.html']) {
    if (!existsSync(path.join(client, page))) throw new Error(`Missing static route: ${page}`);
  }
  // Vinext's exporter redirects trailingSlash routes before rendering them.
  // Export without redirects, then provide directory indexes for Pages.
  mkdirSync(path.join(client, 'playground'), {recursive:true});
  copyFileSync(path.join(client, 'playground.html'), path.join(client, 'playground/index.html'));
  writeFileSync(path.join(client, '.nojekyll'), '');
  const html = readFileSync(path.join(client, 'index.html'), 'utf8');
  if (!html.includes('/varyloom/_next/') || !html.includes('/varyloom/fonts/')) {
    throw new Error('The static export is missing its GitHub Pages asset prefix.');
  }
  console.log('GitHub Pages export verified: / and /playground/.');
};
// Let Vite's native worker handles close naturally; immediate process.exit()
// in the Vinext CLI triggers a libuv assertion on Windows after successful builds.
process.exit = finish;
process.argv = [process.execPath, fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url)), 'build'];
await import('../node_modules/vinext/dist/cli.js');
