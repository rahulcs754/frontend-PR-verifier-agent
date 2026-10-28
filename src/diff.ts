import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { DiffResult } from './types.ts';

export interface ImageDiff extends Omit<DiffResult, 'path'> {
  /** Diff image as PNG: changed pixels in red over a faded copy of the base */
  png: Buffer;
}

/**
 * Pixel-diffs two PNGs. Images with different sizes are padded to the larger
 * size, so the extra area counts as changed (a page that got taller is a change).
 */
export function diffImages(baseBuf: Buffer, previewBuf: Buffer, pixelThreshold = 0.1): ImageDiff {
  const base = PNG.sync.read(baseBuf);
  const preview = PNG.sync.read(previewBuf);
  const width = Math.max(base.width, preview.width);
  const height = Math.max(base.height, preview.height);
  const sizeChanged = base.width !== preview.width || base.height !== preview.height;

  const a = pad(base, width, height);
  const b = pad(preview, width, height);
  const out = new PNG({ width, height });

  const diffPixels = pixelmatch(a, b, out.data, width, height, {
    threshold: pixelThreshold,
    includeAA: false,
    alpha: 0.2,
  });
  const totalPixels = width * height;

  return {
    diffPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    sizeChanged,
    png: PNG.sync.write(out),
  };
}

/**
 * Copies the image into a width x height RGBA buffer. Padding is opaque magenta:
 * pixelmatch blends transparency with white, so transparent padding would match
 * a white page and hide the size change.
 */
function pad(img: PNG, width: number, height: number): Uint8Array {
  if (img.width === width && img.height === height) return img.data;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  for (let y = 0; y < img.height; y++) {
    const src = y * img.width * 4;
    data.set(img.data.subarray(src, src + img.width * 4), y * width * 4);
  }
  return data;
}
