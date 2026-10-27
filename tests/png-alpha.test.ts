import { describe, expect, it } from 'vitest';
import { validatePngBytes, pngBytesDataUrl, type PngAlphaMode } from '../src/core/png';
import { inspectAlpha } from '../src/io/alpha';
import { exportGLB } from '../src/io/export';
import { rawPng, type Chunk } from './png-fixtures';
import { makeAtlas, makeProject } from './fixtures';

interface AlphaCase {
  name: string;
  depth: number;
  color: number;
  row: number[];
  mode: PngAlphaMode;
  extras?: Chunk[];
  interlace?: number;
}

const cases: AlphaCase[] = [
  { name: 'opaque RGBA', depth: 8, color: 6, row: [255, 0, 0, 255], mode: 'opaque' },
  { name: 'cutout RGBA', depth: 8, color: 6, row: [255, 0, 0, 0], mode: 'cutout' },
  { name: 'fractional RGBA', depth: 8, color: 6, row: [255, 0, 0, 128], mode: 'blend' },
  { name: '16-bit fractional RGBA', depth: 16, color: 6, row: [255, 255, 0, 0, 0, 0, 255, 254], mode: 'blend' },
  { name: 'gray alpha', depth: 8, color: 4, row: [42, 128], mode: 'blend' },
  { name: '16-bit gray alpha', depth: 16, color: 4, row: [0, 42, 0, 1], mode: 'blend' },
  { name: 'Adam7 alpha', depth: 8, color: 6, row: [255, 0, 0, 128], mode: 'blend', interlace: 1 },
  { name: 'packed grayscale transparency', depth: 1, color: 0, row: [128], mode: 'cutout', extras: [{ type: 'tRNS', data: new Uint8Array([0, 1]) }] },
  { name: '16-bit grayscale transparency', depth: 16, color: 0, row: [18, 52], mode: 'cutout', extras: [{ type: 'tRNS', data: new Uint8Array([18, 52]) }] },
  { name: 'RGB transparency key', depth: 8, color: 2, row: [4, 5, 6], mode: 'cutout', extras: [{ type: 'tRNS', data: new Uint8Array([0, 4, 0, 5, 0, 6]) }] },
];

describe('portable PNG alpha inspection', () => {
  it.each(cases)('$name', ({ depth, color, row, mode, extras, interlace }) => {
    const png = rawPng(1, 1, depth, color, interlace ?? 0, new Uint8Array([0, ...row]), extras);
    expect(validatePngBytes(png).alphaMode).toBe(mode);
  });

  it('only considers palette entries sampled by pixels', () => {
    const extras: Chunk[] = [
      { type: 'PLTE', data: new Uint8Array([255, 0, 0, 0, 0, 255]) },
      { type: 'tRNS', data: new Uint8Array([255, 128]) },
    ];
    expect(validatePngBytes(rawPng(1, 1, 1, 3, 0, new Uint8Array([0, 0]), extras)).alphaMode).toBe('opaque');
    expect(validatePngBytes(rawPng(1, 1, 1, 3, 0, new Uint8Array([0, 128]), extras)).alphaMode).toBe('blend');
  });

  it('uses fractional alpha in Node GLB export without canvas or an override', async () => {
    const png = rawPng(2, 2, 8, 6, 0, new Uint8Array([
      0, 255, 0, 0, 128, 255, 0, 0, 255,
      0, 255, 0, 0, 255, 255, 0, 0, 255,
    ]));
    const project = makeProject({ atlases: [makeAtlas({ dataUrl: pngBytesDataUrl(png) })] });
    expect((await inspectAlpha(project)).get('atlas-a')).toBe('blend');
    const bytes = await exportGLB(project);
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + length)));
    expect(json.materials[0].alphaMode).toBe('BLEND');
  });
});
