import { validatePngDataUrl, type PngAlphaMode } from '../core/png';
import type { Project } from '../core/types';

export async function inspectAlpha(project: Project): Promise<Map<string, PngAlphaMode>> {
  const result = new Map<string, PngAlphaMode>();
  const used = new Set(project.tiles.map(tile => tile.atlasId));
  for (const atlas of project.atlases.filter(atlas => used.has(atlas.id))) {
    const info = validatePngDataUrl(atlas.dataUrl, { width: atlas.width, height: atlas.height });
    if (!info.alphaMode) throw new Error('PNG alpha inspection did not complete');
    result.set(atlas.id, info.alphaMode);
  }
  return result;
}
