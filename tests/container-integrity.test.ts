import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { openContainer } from '../src/io/util';

function archive(): Uint8Array {
  return zipSync({ 'project.json': strToU8('{"name":"intact"}') }, { level: 0 });
}

describe('native archive integrity', () => {
  it('accepts intact stored ZIP entries', () => {
    expect(openContainer(archive()).projectJson).toBe('{"name":"intact"}');
  });

  it('rejects a changed payload even when the ZIP remains readable', () => {
    const bytes = archive();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start + 10] ^= 1;
    expect(() => openContainer(bytes)).toThrow(/checksum/);
  });

  it('rejects a mismatched local file name', () => {
    const bytes = archive();
    bytes[30] = 'x'.charCodeAt(0);
    expect(() => openContainer(bytes)).toThrow(/payload/);
  });

  it('rejects multipart ZIP metadata and trailing garbage', () => {
    const bytes = archive();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(bytes.length - 22 + 4, 1, true);
    expect(() => openContainer(bytes)).toThrow(/directory/);
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(archive());
    expect(() => openContainer(trailing)).toThrow(/directory/);
  });
});
