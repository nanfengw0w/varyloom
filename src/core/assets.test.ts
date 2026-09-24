import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadItems } from './assets';

class FakeImage extends EventTarget {
  complete = false;
  naturalWidth = 640;
  naturalHeight = 480;
  addEventListener = vi.fn(super.addEventListener.bind(this));
  removeEventListener = vi.fn(super.removeEventListener.bind(this));
}

class FakeBitmap {
  width = 640;
  height = 480;
  close = vi.fn();
}

const asImage = (image: FakeImage) => image as unknown as HTMLImageElement;
const asBitmap = (bitmap: FakeBitmap) => bitmap as unknown as ImageBitmap;

describe('image resource ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLImageElement', FakeImage);
    vi.stubGlobal('ImageBitmap', FakeBitmap);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('releases successful and late owned bitmaps when another image fails', async () => {
    const early = new FakeBitmap();
    const late = new FakeBitmap();
    const failed = new FakeImage();
    let finishLate!: (image: FakeBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce(early)
      .mockImplementationOnce(() => new Promise((resolve) => { finishLate = resolve; })));
    const loading = loadItems([
      { image: new Blob() }, { image: new Blob() }, { image: asImage(failed) },
    ], 'anonymous');
    const rejected = expect(loading).rejects.toThrow('Unable to load image element.');

    await vi.waitFor(() => expect(finishLate).toBeDefined());
    failed.dispatchEvent(new Event('error'));
    await rejected;
    expect(early.close).toHaveBeenCalledOnce();
    finishLate(late);
    await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce());
  });

  it('only closes owned bitmaps and releases them once', async () => {
    const owned = new FakeBitmap();
    const external = new FakeBitmap();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(owned));

    const images = await loadItems([{ image: new Blob() }, { image: asBitmap(external) }], 'anonymous');
    images.forEach((image) => { image.release(); image.release(); });

    expect(owned.close).toHaveBeenCalledOnce();
    expect(external.close).not.toHaveBeenCalled();
  });

  it('releases completed bitmaps immediately on abort while another decode is pending', async () => {
    const early = new FakeBitmap();
    const late = new FakeBitmap();
    let finishLate!: (image: FakeBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce(early)
      .mockImplementationOnce(() => new Promise((resolve) => { finishLate = resolve; })));
    const abort = new AbortController();
    const loading = loadItems([{ image: new Blob() }, { image: new Blob() }], 'anonymous', abort.signal);
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finishLate).toBeDefined());
    // Allow the already-resolved first decode to finish its loading microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    abort.abort();
    expect(early.close).toHaveBeenCalledOnce();
    finishLate(late);
    await rejected;

    expect(early.close).toHaveBeenCalledOnce();
    expect(late.close).toHaveBeenCalledOnce();
  });

  it('removes both image listeners after a load or cancellation', async () => {
    const loaded = new FakeImage();
    const pending = new FakeImage();
    const abort = new AbortController();
    const loading = loadItems([{ image: asImage(loaded) }, { image: asImage(pending) }], 'anonymous', abort.signal);
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });

    loaded.dispatchEvent(new Event('load'));
    abort.abort();
    await rejected;

    for (const image of [loaded, pending]) {
      const listenerTypes = image.removeEventListener.mock.calls.map(([type]) => type);
      expect(listenerTypes).toContain('load');
      expect(listenerTypes).toContain('error');
    }
  });

  it('clears URL image handlers and cancels only the library-owned request', async () => {
    const requests: Array<{ src: string; onload: null | (() => void); onerror: null | (() => void) }> = [];
    vi.stubGlobal('Image', class {
      src = '';
      onload = null;
      onerror = null;
      constructor() { requests.push(this); }
    });
    const loading = loadItems([{ image: 'failed.jpg' }, { image: 'pending.jpg' }], 'anonymous');
    const rejected = expect(loading).rejects.toThrow('Unable to load image: failed.jpg');

    requests[0].onerror?.();
    await rejected;

    expect(requests[0].onload).toBeNull();
    expect(requests[0].onerror).toBeNull();
    expect(requests[1]).toMatchObject({ src: '', onload: null, onerror: null });
  });
});
