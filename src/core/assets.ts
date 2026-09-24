import type { LoadedImage, VaryloomItem, VaryloomImageSource } from '../types';

function isImageBitmap(value: VaryloomImageSource): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

async function loadHtmlImage(
  source: string | HTMLImageElement,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
): Promise<HTMLImageElement> {
  if (source instanceof HTMLImageElement) {
    if (!source.complete) {
      await new Promise<void>((resolve, reject) => {
        source.addEventListener('load', () => resolve(), { once: true });
        source.addEventListener('error', () => reject(new Error('Unable to load image element.')), { once: true });
      });
    }
    if (typeof source.decode === 'function') await source.decode().catch(() => undefined);
    return source;
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    if (crossOrigin && !source.startsWith('data:') && !source.startsWith('blob:')) {
      image.crossOrigin = crossOrigin;
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${source}`));
    image.src = source;
  });
}

async function loadSource(
  source: VaryloomImageSource,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
): Promise<{ source: HTMLImageElement | ImageBitmap; owned: boolean }> {
  if (typeof source === 'string' || source instanceof HTMLImageElement) {
    return { source: await loadHtmlImage(source, crossOrigin), owned: typeof source === 'string' };
  }
  if (isImageBitmap(source)) return { source, owned: false };
  if (source instanceof Blob) return { source: await createImageBitmap(source), owned: true };
  throw new TypeError('Unsupported image source.');
}

export async function loadItems<TData>(
  items: Array<VaryloomItem<TData>>,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
): Promise<Array<LoadedImage<TData>>> {
  return Promise.all(items.map(async (item) => {
    const loaded = await loadSource(item.image, crossOrigin);
    const width = loaded.source instanceof HTMLImageElement
      ? loaded.source.naturalWidth
      : loaded.source.width;
    const height = loaded.source instanceof HTMLImageElement
      ? loaded.source.naturalHeight
      : loaded.source.height;

    return {
      ...item,
      source: loaded.source,
      width,
      height,
      release: () => {
        if (loaded.owned && isImageBitmap(loaded.source)) loaded.source.close();
      },
    };
  }));
}
