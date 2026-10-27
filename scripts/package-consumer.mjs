import assert from 'node:assert/strict';
import * as api from '__PACKAGE__';
import * as headless from '__PACKAGE__/headless';
import * as core from '__PACKAGE__/core';
import * as io from '__PACKAGE__/io';
import { deflateSync } from 'node:zlib';

assert.equal(typeof globalThis.document, 'undefined');
assert.equal(typeof globalThis.window, 'undefined');
assert.equal(api.createProject, core.createProject);
assert.equal(api.createProject, headless.createProject);
assert.equal(io.downloadFile, undefined);
assert.equal(io.saveAutosave, undefined);
if ('saveNative' in io) {
  const project = api.createProject(2, 2, 'consumer');
  const rgba = api.renderFrame(project, project.frames[0].id);
  assert.equal(rgba.length, 16);
  assert.equal(io.loadNative(io.saveNative(project)).name, 'consumer');
  assert.equal(io.decodePNG(io.encodePNG(2, 2, rgba)).width, 2);
  const codecs = await import('__PACKAGE__/codecs');
  assert.equal(codecs.encodePNG, io.encodePNG);
} else if ('exportGLTF' in io) {
  const project = api.createProject('consumer');
  project.meshes.push(api.createPrimitive('cube'));
  assert.equal(api.parseProject(api.serializeProject(project)).name, 'consumer');
  assert.ok(io.exportOBJ(project).files.length >= 3);
  assert.ok(io.exportGLTF(project, { animation: true }).files.length >= 3);
  const rgba = new Uint8Array([255, 0, 0, 128]);
  assert.equal(io.decodePNG(io.encodePNG(1, 1, rgba)).width, 1);
  assert.ok(io.encodeGIF([rgba], 1, 1, project.texture, 12).length > 0);
} else {
  const project = api.createProject('consumer');
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, sum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,128]))), chunk('IEND', Buffer.alloc(0))]);
  project.atlases.push({ id: 'alpha', name: 'alpha', width: 1, height: 1, tileWidth: 1, tileHeight: 1, margin: 0, spacing: 0, dataUrl: api.pngBytesDataUrl(png) });
  api.makeTile(project, api.createSession(project), [0, 0, 0]);
  assert.equal((await io.decodeProject(await io.encodeProject(project))).name, 'consumer');
  assert.equal((await io.inspectAlpha(project)).get('alpha'), 'blend');
  const glb = await io.exportGLB(project);
  const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));
  assert.equal(json.materials[0].alphaMode, 'BLEND');
  assert.ok((await io.exportOBJ(project)).length > 0);
}
console.log('__PACKAGE__: headless package consumer operations passed');
