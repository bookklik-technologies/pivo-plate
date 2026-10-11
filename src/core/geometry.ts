import type { Tile, Vec3 } from './types';

function cross(a:Vec3,b:Vec3,c:Vec3):Vec3 {
  const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
}
function normalize(v:Vec3):Vec3 {
  const length=Math.hypot(...v);
  if(!length||!Number.isFinite(length)) return [0,0,0];
  return v.map(n=>n===0?0:n/length) as Vec3;
}
/** Area-weighted normals within each quad's fixed diagonal. Corners 1 and 3
 * use their sole incident triangle; 0/2 average both. No cross-tile welding.
 * This is the same indexed-mesh policy as Three.computeVertexNormals(). */
export function tileCornerNormals(tile:Tile):[Vec3,Vec3,Vec3,Vec3] {
  const [a,b,c,d]=tile.vertices;
  const first=cross(a,b,c),second=cross(a,c,d);
  const sum=first.map((n,i)=>n+second[i]) as Vec3;
  const shared=Math.hypot(...sum)>0?sum:(Math.hypot(...first)>0?first:second);
  const sign=tile.reversed?-1:1;
  const signed=(v:Vec3)=>normalize(v).map(n=>n===0?0:n*sign) as Vec3;
  return [signed(shared),signed(first),signed(shared),signed(second)];
}
