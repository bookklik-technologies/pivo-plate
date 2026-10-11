// Independent interoperability tests: decode our exported formats with
// three.js's own loaders (GLTFLoader / OBJLoader + MTLLoader) instead of
// trusting our encoders. Runs headless in vitest's DOM environment with a
// stubbed TextureLoader (pixels are validated separately by structure tests;
// here we care that geometry, materials, UVs and alpha modes survive).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import * as THREE from 'three';
import { exportGLB, exportOBJ } from '../src/io/export.ts';
import { cubeProject, makeProject, makeTile, makeObject } from './fixtures.ts';

// three's TextureLoader goes through ImageLoader -> Image/createImageBitmap.
// Headless: serve a 1x1 stub image through a canvas-like object instead.
// GLTFLoader also references `self` (browser global) directly.
beforeAll(() => {
  (globalThis as Record<string, unknown>).self = globalThis;
  const stubImage = { width: 2, height: 2, data: new Uint8Array(16) };
  const loaderProto = THREE.TextureLoader.prototype as unknown as {
    load: (url: string, onLoad?: (img: unknown) => void) => unknown;
  };
  vi.spyOn(loaderProto, 'load').mockImplementation(function (this: unknown, _url, onLoad) {
    const texture = new THREE.Texture(stubImage as never);
    if (typeof onLoad === 'function') queueMicrotask(() => onLoad(texture));
    return texture;
  });
  // MTLLoader consults the LoadingManager for a handler per texture URL first;
  // register a stub loader there so it never touches real image loading.
  const stubTextureLoader = { load: (_url: string, onLoad?: (t: unknown) => void) => {
    const tex = new THREE.Texture();
    if (typeof onLoad === 'function') queueMicrotask(() => onLoad(tex));
    return tex;
  } };
  THREE.DefaultLoadingManager.addHandler(/textures\/.*\.png$/, stubTextureLoader as never);
});

async function loadGltf(bytes: Uint8Array): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
  const gltf = await loader.parseAsync(arrayBuffer, '');
  return gltf.scene as THREE.Group;
}

describe('GLB ↔ three GLTFLoader', () => {
  it('loads as a scene with a mesh with baked vertex positions', async () => {
    const bytes = await exportGLB(cubeProject());
    const scene = await loadGltf(bytes);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(1);
    const mesh = meshes[0];
    // Y-up meters preserved: bounding box spans 0..1 on all axes
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(0);
    expect(bb.min.y).toBeCloseTo(0);
    expect(bb.min.z).toBeCloseTo(0);
    expect(bb.max.x).toBeCloseTo(1);
    expect(bb.max.y).toBeCloseTo(1);
    expect(bb.max.z).toBeCloseTo(1);
  });

  it('geometry is indexed triangles with position/uv/normal attributes', async () => {
    const scene = await loadGltf(await exportGLB(cubeProject()));
    const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const g = mesh.geometry;
    expect(g.index).not.toBeNull();
    expect(g.attributes.position).toBeDefined();
    expect(g.attributes.uv).toBeDefined();
    expect(g.attributes.normal).toBeDefined();
    expect(g.index!.count).toBe(36); // 6 tiles × 2 triangles × 3
    // all UVs inside 0..1
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('preserves baked coordinates for an offset tile (no re-centering)', async () => {
    const p = makeProject({ tiles: [makeTile({ vertices: [[2, 3, 4], [3, 3, 4], [3, 3, 5], [2, 3, 5]] })] });
    const scene = await loadGltf(await exportGLB(p));
    const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    // find the corner (2,3,4) among the 4 vertices
    const found = [0, 1, 2, 3].some((i) =>
      pos.getX(i) === 2 && pos.getY(i) === 3 && pos.getZ(i) === 4);
    expect(found).toBe(true);
  });

  it('material arrives with the right alphaMode and pixel-art filtering', async () => {
    const scene = await loadGltf(await exportGLB(cubeProject()));
    const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    // three maps glTF MASK → alphaTest > 0, BLEND → transparent = true
    expect(mat.transparent).toBe(false);
    expect(mat.alphaTest).toBeGreaterThan(0);
    const map = mat.map;
    expect(map).toBeDefined();
    if (map) {
      expect(map.magFilter).toBe(THREE.NearestFilter);
      expect(map.minFilter).toBe(THREE.NearestFilter);
    }
  });

  it('two atlases produce two primitives / material groups', async () => {
    const p = makeProject({
      atlases: [makeAtlasA(), makeAtlasB()],
      tiles: [
        makeTile({ atlasId: 'atlas-a' }),
        makeTile({ id: 't2', atlasId: 'atlas-b', vertices: [[0, 2, 0], [1, 2, 0], [1, 2, 1], [0, 2, 1]] }),
      ],
    });
    const scene = await loadGltf(await exportGLB(p));
    // one mesh per glTF primitive, grouped under a THREE.Group
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(2);
    expect(meshes[0].material).not.toBe(meshes[1].material);
    expect((meshes[0].material as THREE.MeshStandardMaterial).name)
      .not.toBe((meshes[1].material as THREE.MeshStandardMaterial).name);
  });
});

describe('OBJ ZIP ↔ three OBJLoader + MTLLoader', () => {
  it('loads with baked coordinates, triangulation and UVs', async () => {
    const bytes = await exportOBJ(cubeProject());
    const files = unzip(bytes);
    const objText = files['pivo-plate.obj'];
    const mtlText = files['pivo-plate.mtl'];

    // MaterialCreator from the MTL, applied to the OBJ.
    const mtlLoader = new MTLLoader();
    const creator = mtlLoader.parse(mtlText, '');
    creator.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(creator);
    const group = objLoader.parse(objText);

    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThan(0);

    const mesh = meshes[0];
    const g = mesh.geometry as THREE.BufferGeometry;
    expect(g.attributes.position).toBeDefined();
    expect(g.attributes.uv).toBeDefined();
    // triangulated: 6 tiles → 12 triangles → 36 indexed or 36 raw verts
    const triCount = g.index ? g.index.count / 3 : (g.attributes.position.count / 3);
    expect(triCount).toBe(12);
  });

  it('reversed tiles keep flipped normals after the round-trip', async () => {
    const bytes = await exportOBJ(makeProject({
      tiles: [
        // CCW as seen from +Y (u×w = +Y): matches the contract's XZ-facing-+Y
        makeTile({ id: 'up', vertices: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], reversed: false }),
        makeTile({ id: 'down', vertices: [[0, 2, 0], [0, 2, 1], [1, 2, 1], [1, 2, 0]], reversed: true }),
      ],
    }));
    const files = unzip(bytes);
    const mtlLoader = new MTLLoader();
    const creator = mtlLoader.parse(files['pivo-plate.mtl'], '');
    creator.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(creator);
    const group = objLoader.parse(files['pivo-plate.obj']);

    // OBJLoader merges same-material geometry into one mesh — walk per-vertex
    // normals: first triangle belongs to the normal tile (+Y), last to the
    // reversed one (−Y).
    let ny: number[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry.attributes.normal) {
        const n = mesh.geometry.attributes.normal as THREE.BufferAttribute;
        for (let i = 0; i < n.count; i++) ny.push(n.getY(i));
      }
    });
    expect(ny.length).toBeGreaterThan(0);
    expect(ny[0]).toBeCloseTo(1); // +Y
    expect(ny[ny.length - 1]).toBeCloseTo(-1); // reversed → −Y
  });

  it('materials survive with their map references and transparency values', async () => {
    const bytes = await exportOBJ(makeProject({
      atlases: [makeAtlasA({ name: 'Tex' })],
    }));
    const files = unzip(bytes);
    const creator = new MTLLoader().parse(files['pivo-plate.mtl'], '');
    const material = creator.create('Tex') as THREE.MeshPhongMaterial;
    expect(material).toBeDefined();
    expect(material.transparent).toBe(false); // d 1.000 → opaque
    expect(material.map).toBeDefined(); // map_Kd wiring succeeded
  });
});

// --- helpers ---------------------------------------------------------------
import { unzipSync } from 'fflate';
import { makeAtlas } from './fixtures.ts';

function unzip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) out[k] = new TextDecoder().decode(v);
  return out;
}

function makeAtlasA(overrides: Record<string, unknown> = {}) {
  return makeAtlas({ id: 'atlas-a', name: 'AtlasA', ...overrides } as never);
}
function makeAtlasB(overrides: Record<string, unknown> = {}) {
  return makeAtlas({ id: 'atlas-b', name: 'AtlasB', ...overrides } as never);
}
