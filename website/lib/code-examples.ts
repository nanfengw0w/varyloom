import { photographs, type Lang } from './catalog';

export type ExampleFramework = 'react' | 'vanilla';

export interface ExampleSettings {
  effect: string;
  options: Record<string, unknown>;
  duration: number;
  easing: string;
  autoplay: boolean;
  startIndex: number;
  lang: Lang;
}

// Escape HTML delimiters so a text parameter cannot close an inline module script.
function literal(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function createCodeExample(framework: ExampleFramework, settings: ExampleSettings): string {
  const { effect, options, duration, easing, autoplay, startIndex, lang } = settings;
  const words = lang === 'zh'
    ? { previous: '上一张', next: '下一张', error: '无法加载画廊。请检查图片地址和浏览器兼容性。', title: '影像画廊', loading: '正在准备影像…' }
    : { previous: 'Previous', next: 'Next', error: 'Unable to load the gallery. Check the image URLs and browser compatibility.', title: 'Image gallery', loading: 'Preparing the images…' };
  const items = literal(photographs.map(photo => ({ image: photo.remote, alt: photo.alt[lang] })));
  const optionType = `${effect.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('')}Options`;
  const usesEasing = effect === 'ink-reveal' || effect === 'melt';

  if (framework === 'react') {
    return `'use client';

import { useRef, useState } from 'react';
import type { VaryloomController, VaryloomItem, ${optionType} } from 'varyloom';
import { VaryloomSlider } from 'varyloom/react';

const items: VaryloomItem[] = ${items};
const effectOptions = ${literal(options)} satisfies ${optionType};

export default function Gallery() {
  const slider = useRef<VaryloomController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(${startIndex});

  return (
    <section aria-label=${literal(words.title)}>
      <div style={{ width: '100%', aspectRatio: '16 / 10' }}>
        <VaryloomSlider
          ref={slider}
          items={items}
          effect=${literal(effect)}
          effectOptions={effectOptions}
          startIndex={${startIndex}}
          duration={${duration}}
${usesEasing ? `          easing=${literal(easing)}\n` : ''}          autoplay={${autoplay}}
          autoplayDelay={2.6}
          fallbackEffect="melt"
          role="img"
          aria-label={items[index].alt}
          onReady={() => setReady(true)}
          onIndexChange={({ index: nextIndex }) => setIndex(nextIndex)}
          onError={() => { setError(true); setReady(false); }}
        />
      </div>
      <p aria-live="polite">{items[index].alt}</p>
      {error && <p role="alert">${words.error}</p>}
      <button disabled={!ready} onClick={() => slider.current?.prev()}>${words.previous}</button>
      <button disabled={!ready} onClick={() => slider.current?.next()}>${words.next}</button>
    </section>
  );
}`;
  }

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${words.title}</title>
    <style>
      body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: #151613; color: #f0f0e6; }
      main { max-width: 960px; margin: auto; }
      #gallery { width: 100%; aspect-ratio: 16 / 10; }
      button { margin-right: 12px; padding: 10px 20px; cursor: pointer; }
    </style>
  </head>
  <body>
    <main aria-label="${words.title}">
      <div id="gallery" role="img"></div>
      <p id="description" aria-live="polite">${words.loading}</p>
      <button id="previous" disabled>${words.previous}</button>
      <button id="next" disabled>${words.next}</button>
    </main>
    <script type="module">
      import { createVaryloom } from 'varyloom';

      const items = ${items.replace(/\n/g, '\n      ')};
      const host = document.getElementById('gallery');
      const description = document.getElementById('description');
      const previous = document.getElementById('previous');
      const next = document.getElementById('next');
      if (!host || !description || !(previous instanceof HTMLButtonElement) || !(next instanceof HTMLButtonElement)) {
        throw new Error(${literal(words.error)});
      }
      /** @type {import('varyloom').Varyloom | undefined} */
      let slider;
      let disposed = false;
      /** @param {number} index */
      const updateDescription = (index) => {
        host.setAttribute('aria-label', items[index].alt);
        description.textContent = items[index].alt;
      };
      const destroyGallery = () => {
        disposed = true;
        slider?.destroy();
        previous.disabled = true;
        next.disabled = true;
        previous.onclick = null;
        next.onclick = null;
      };
      window.addEventListener('pagehide', destroyGallery, { once: true });
      if (import.meta.hot) import.meta.hot.dispose(destroyGallery);

      try {
        slider = await createVaryloom(host, {
          items,
          effect: ${literal(effect)},
          effectOptions: ${literal(options).replace(/\n/g, '\n          ')},
          startIndex: ${startIndex},
          duration: ${duration},
${usesEasing ? `          easing: ${literal(easing)},\n` : ''}          autoplay: ${autoplay},
          autoplayDelay: 2.6,
          fallbackEffect: 'melt',
        });
        if (disposed) {
          slider.destroy();
        } else {
          updateDescription(slider.currentIndex);
          slider.on('indexchange', ({ index }) => updateDescription(index));
          previous.onclick = () => slider?.prev();
          next.onclick = () => slider?.next();
          previous.disabled = false;
          next.disabled = false;
        }
      } catch (error) {
        description.setAttribute('role', 'alert');
        description.textContent = ${literal(words.error)};
        console.error(error);
      }
    </script>
  </body>
</html>`;
}
