import { describe, it, expect } from 'vitest';
import { exportOBJ, exportGLB, ExportError } from '../src/io/export.ts';
import { unzipSync, strFromU8 } from 'fflate';
import { makeProject, makeTile, makeObject, makeAtlas, cubeProject } from './fixtures.ts';
import type { Project, Vec3 } from '../src/core/types.ts';

function parseObj(text: string) {
  const vertices: Vec3[] = [];
  const uvs: [number, number][] = [];
  const normals: Vec3[] = [];
  const faces: number[][] = [];
  const objects: string[] = [];
  const materials: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    else if (parts[0] === 'vt') uvs.push([Number(parts[1]), Number(parts[2])]);
    else if (parts[0] === 'vn') normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    else if (parts[0] === 'f') faces.push(parts.slice(1).map((p) => Number(p.split('/')[0])));
    else if (parts[0] === 'o') objects.push(parts[1]);
    else if (parts[0] === 'usemtl') materials.push(parts[1]);
  }
  return { vertices, uvs, normals, faces, objects, materials };
}

describe('exportOBJ', () => {
  it('produces a ZIP with .obj, .mtl and PNG textures', async () => {
    const bytes = await exportOBJ(makeProject());
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('pivo-plate.obj');
    expect(Object.keys(files)).toContain('pivo-plate.mtl');
    expect(Object.keys(files)).toContain('textures/atlas-a.png');
    const objText = strFromU8(files['pivo-plate.obj']);
    expect(objText).toContain('mtllib pivo-plate.mtl');
  });

  it('bakes world-space vertices (objects carry no transforms)', async () => {
    const p = makeProject({
      tiles: [makeTile({ vertices: [[2, 3, 4], [3, 3, 4], [3, 3, 5], [2, 3, 5]] })],
    });
    const bytes = await exportOBJ(p);
    const obj = parseObj(strFromU8(unzipSync(bytes)['pivo-plate.obj']));
    expect(obj.vertices).toEqual([[2, 3, 4], [3, 3, 4], [3, 3, 5], [2, 3, 5]]);
  });

  it('triangulates quads [0,1,2 / 0,2,3] and reverses winding for reversed tiles', async () => {
    const p = makeProject({
      tiles: [
        makeTile({ id: 'normal-tile', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], reversed: false }),
        makeTile({ id: 'flipped-tile', vertices: [[0, 2, 0], [1, 2, 0], [1, 2, 1], [0, 2, 1]], reversed: true }),
      ],
    });
    const bytes = await exportOBJ(p);
    const obj = parseObj(strFromU8(unzipSync(bytes)['pivo-plate.obj']));
    // 4 faces total (2 tiles × 2 triangles), 8 vertices.
    expect(obj.faces.length).toBe(4);
    expect(obj.vertices.length).toBe(8);
    // Normal tile: [1,2,3] then [1,3,4] (1-based, per-tile vertex block).
    expect(obj.faces[0]).toEqual([1, 2, 3]);
    expect(obj.faces[1]).toEqual([1, 3, 4]);
    // Reversed tile (vertex block 5..8): swapped winding [5,7,6] then [5,8,7].
    expect(obj.faces[2]).toEqual([5, 7, 6]);
    expect(obj.faces[3]).toEqual([5, 8, 7]);
  });

  it('normals flip for reversed tiles (geometric cross product)', async () => {
    const p = cubeProject();
    const bytes = await exportOBJ(p);
    const obj = parseObj(strFromU8(unzipSync(bytes)['pivo-plate.obj']));
    // top tile (+Y) is first in the cube fixture
    expect(obj.normals[0]).toEqual([0, 1, 0]);
    // bottom tile is reversed → -Y
    const bottomIndex = 4; // second tile, its 4 vn records start at index 4
    for (let i = 0; i < 4; i++) {
      expect(obj.normals[bottomIndex + i]).toEqual([0, -1, 0]);
    }
  });

  it('excludes tiles under hidden objects and hidden ancestors', async () => {
    const p = makeProject({
      objects: [
        makeObject({ id: 'object-main', visible: true }),
        makeObject({ id: 'child', parentId: 'object-main', visible: false }),
        makeObject({ id: 'grandchild', parentId: 'child', visible: true }), // ancestor hidden
      ],
      tiles: [
        makeTile({ id: 'visible-tile', objectId: 'object-main' }),
        makeTile({ id: 'hidden-child-tile', objectId: 'child', vertices: [[0, 5, 0], [1, 5, 0], [1, 5, 1], [0, 5, 1]] }),
        makeTile({ id: 'hidden-ancestor-tile', objectId: 'grandchild', vertices: [[0, 6, 0], [1, 6, 0], [1, 6, 1], [0, 6, 1]] }),
      ],
    });
    const bytes = await exportOBJ(p);
    const obj = parseObj(strFromU8(unzipSync(bytes)['pivo-plate.obj']));
    expect(obj.vertices.length).toBe(4); // only the visible tile
  });

  it('writes unique material names and real transparency settings', async () => {
    const p = makeProject({
      atlases: [
        makeAtlas({ id: 'a1', name: 'Bricks!' }),
        makeAtlas({ id: 'a2', name: 'Bricks!' }), // duplicate name on purpose
      ],
      tiles: [makeTile({ atlasId: 'a1' }), makeTile({ id: 't2', atlasId: 'a2' })],
    });
    const bytes = await exportOBJ(p);
    const files = unzipSync(bytes);
    const mtl = strFromU8(files['pivo-plate.mtl']);
    const obj = parseObj(strFromU8(files['pivo-plate.obj']));
    // two distinct material names, both referenced from the obj
    const newmtls = mtl.split(/\r?\n/).filter((l) => l.startsWith('newmtl'));
    expect(newmtls.length).toBe(2);
    expect(new Set(newmtls).size).toBe(2);
    expect(obj.materials.length).toBe(2);
    expect(new Set(obj.materials).size).toBe(2);
    // explicit d (dissolve) lines present; opaque uses d 1.0
    expect(mtl).toMatch(/d 1\.000/);
    expect(mtl).toMatch(/map_Kd textures\/a1\.png/);
  });

  it('rejects projects with no visible tiles and unknown atlas refs', async () => {
    const empty = makeProject({ objects: [makeObject({ visible: false })] });
    await expect(exportOBJ(empty)).rejects.toBeInstanceOf(ExportError);
    const ghost = makeProject({ tiles: [makeTile({ atlasId: 'nope' })] });
    await expect(exportOBJ(ghost)).rejects.toThrow(/atlas/i);
  });

  it('does not mutate the source project', async () => {
    const p = cubeProject();
    const snap = JSON.stringify(p);
    await exportOBJ(p);
    await exportGLB(p);
    expect(JSON.stringify(p)).toBe(snap);
  });
});
