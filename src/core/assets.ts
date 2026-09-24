import type { LoadedImage, VaryloomItem, VaryloomImageSource } from '../types';

function isImageBitmap(value: VaryloomImageSource): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

async function loadHtmlImage(
  source: string | HTMLImageElement,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  if (source instanceof HTMLImageElement) {
    if (!source.complete) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          source.removeEventListener('load', onLoad);
          source.removeEventListener('error', onError);
          signal.removeEventListener('abort', onAbort);
        };
        const onLoad = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Unable to load image element.')); };
        const onAbort = () => { cleanup(); reject(signal.reason); };
        source.addEventListener('load', onLoad, { once: true });
        source.addEventListener('error', onError, { once: true });
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (typeof source.decode === 'function') await source.decode().catch(() => undefined);
    signal.throwIfAborted();
    return source;
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    if (crossOrigin && !source.startsWith('data:') && !source.startsWith('blob:')) {
      image.crossOrigin = crossOrigin;
    }
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = '';
      reject(signal.reason);
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error(`Unable to load image: ${source}`)); };
    signal.addEventListener('abort', onAbort, { once: true });
    image.src = source;
  });
}

async function loadSource(
  source: VaryloomImageSource,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
  signal: AbortSignal,
): Promise<{ source: HTMLImageElement | ImageBitmap; owned: boolean }> {
  signal.throwIfAborted();
  if (typeof source === 'string' || source instanceof HTMLImageElement) {
    return { source: await loadHtmlImage(source, crossOrigin, signal), owned: typeof source === 'string' };
  }
  if (isImageBitmap(source)) return { source, owned: false };
  if (source instanceof Blob) return { source: await createImageBitmap(source), owned: true };
  throw new TypeError('Unsupported image source.');
}

export async function loadItems<TData>(
  items: Array<VaryloomItem<TData>>,
  crossOrigin: '' | 'anonymous' | 'use-credentials',
  signal?: AbortSignal,
): Promise<Array<LoadedImage<TData>>> {
  const loading = new AbortController();
  const images: Array<LoadedImage<TData>> = [];
  const releaseImages = () => images.forEach((image) => image.release());
  loading.signal.addEventListener('abort', releaseImages, { once: true });
  const abort = () => loading.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
    return await Promise.all(items.map(async (item) => {
      const loaded = await loadSource(item.image, crossOrigin, loading.signal);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (loaded.owned && isImageBitmap(loaded.source)) loaded.source.close();
      };
      // Decoding a Blob cannot be cancelled. Close a late bitmap after another
      // image failed or the controller was destroyed, instead of losing it.
      if (loading.signal.aborted) {
        release();
        loading.signal.throwIfAborted();
      }
      const width = loaded.source instanceof HTMLImageElement
        ? loaded.source.naturalWidth
        : loaded.source.width;
      const height = loaded.source instanceof HTMLImageElement
        ? loaded.source.naturalHeight
        : loaded.source.height;

      const image = {
        ...item,
        source: loaded.source,
        width,
        height,
        release,
      };
      images.push(image);
      return image;
    }));
  } catch (cause) {
    loading.abort(cause);
    throw cause;
  } finally {
    signal?.removeEventListener('abort', abort);
    loading.signal.removeEventListener('abort', releaseImages);
  }
}
