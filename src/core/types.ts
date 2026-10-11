export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type Plane = 'XY' | 'XZ' | 'YZ';
export type Mode = 'draw' | 'edit';
export interface Atlas {
  id: string; name: string; width: number; height: number;
  tileWidth: number; tileHeight: number; margin: number; spacing: number;
  dataUrl: string;
}
export interface AtlasRegion { x: number; y: number; width: number; height: number }
export interface Tile {
  id: string; objectId: string; atlasId: string;
  vertices: [Vec3, Vec3, Vec3, Vec3];
  uvs: [Vec2, Vec2, Vec2, Vec2];
  reversed: boolean;
}
export interface SceneObject {
  id: string; name: string; parentId: string | null;
  visible: boolean; locked: boolean;
}
export interface Project {
  format: 'pivo-plate'; version: 1; name: string;
  atlases: Atlas[]; objects: SceneObject[]; tiles: Tile[];
}
export interface Selection { tileIds: string[]; vertices: {tileId: string; corner: number}[] }
export interface Brush {
  atlasId: string; region: AtlasRegion;
  rotation: 0 | 1 | 2 | 3; flipX: boolean; flipY: boolean;
}
export interface EditorSession {
  mode: Mode; crosshair: Vec3; plane: Plane; planeLocked: boolean;
  grid: number; tileSize: number; activeObjectId: string;
  brush: Brush; selection: Selection;
}
export const DEFAULT_OBJECT_ID = 'object-main';
