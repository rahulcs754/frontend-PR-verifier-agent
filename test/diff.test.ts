import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PNG } from 'pngjs';
import { diffImages } from '../src/diff.ts';

function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('diffImages', () => {
  it('finds no change in identical images', () => {
    const img = solid(10, 10, [255, 255, 255]);
    const d = diffImages(img, img);
    assert.equal(d.diffPixels, 0);
    assert.equal(d.sizeChanged, false);
  });

  it('counts every pixel when colors differ', () => {
    const d = diffImages(solid(10, 10, [255, 255, 255]), solid(10, 10, [0, 0, 0]));
    assert.equal(d.diffPixels, 100);
    assert.equal(d.ratio, 1);
  });

  it('counts the extra area when a white page gets taller', () => {
    const d = diffImages(solid(10, 10, [255, 255, 255]), solid(10, 15, [255, 255, 255]));
    assert.equal(d.sizeChanged, true);
    assert.equal(d.totalPixels, 150);
    assert.equal(d.diffPixels, 50);
    const out = PNG.sync.read(d.png);
    assert.deepEqual([out.width, out.height], [10, 15]);
  });
});
