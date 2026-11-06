import { open } from 'node:fs/promises';
import { previewFile } from './library.mjs';

const MAX_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT = 128;

export function createPreviewReader(images) {
  const cache = new Map();
  return async (item) => {
    if (!images) return null;
    const path = await previewFile(item);
    if (!path) return null;
    let file;
    try {
      file = await open(path, 'r');
      const info = await file.stat();
      if (!info.isFile() || !info.size || info.size > MAX_BYTES) return null;
      const key = `${path}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}`;
      if (cache.has(key)) {
        const result = cache.get(key);
        cache.delete(key);
        cache.set(key, result);
        return result;
      }
      // Bound the actual read as well as stat, including files changed mid-read.
      const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
      let length = 0;
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length !== info.size || length > MAX_BYTES) return null;
      const thumbnail = await images.thumbnail(bytes.subarray(0, length));
      if (thumbnail) {
        cache.set(key, thumbnail);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      }
      return thumbnail;
    } catch {
      return null;
    } finally {
      await file?.close();
    }
  };
}
