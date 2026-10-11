import type { Tile } from '../core/types';
import { ExportError } from './util';
/** Export geometry must have two finite, nonzero-area triangles. */
export function assertExportGeometry(tiles: Tile[]): void {
  for (const t of tiles) {
    for (const [a,b,c] of [[0,1,2],[0,2,3]]) {
      const p=t.vertices[a],q=t.vertices[b],r=t.vertices[c];
      const u=q.map((v,i)=>v-p[i]),v=r.map((n,i)=>n-p[i]);
      const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
      if(!Number.isFinite(area)||area<1e-12) throw new ExportError(`Tile ${t.id} has a degenerate triangle; edit or delete it before exporting`);
    }
  }
}
