import type { Project } from '../core/types.ts';
import { buildContainer, openContainer, dataUrlToBytes, bytesToDataUrl, PayloadError } from './util.ts';
import { validateProjectValue } from './validate.ts';

/**
 * Encode a project into a versioned .pvp archive:
 *   project.json          — the Project document (format/version/name/…)
 *   atlases/<id>.png      — each atlas texture as a real PNG
 * Atlas.dataUrl is not stored redundantly; decodeProject restores it from the
 * extracted PNG bytes, preserving pixel-exact atlas data.
 */
export async function encodeProject(project: Project): Promise<Uint8Array> {
  // Validate + deep clone first: never serialize an invalid document, and the
  // clone is the only thing this function may touch (no source mutation).
  const safe = validateProjectValue(project);
  const textures = [];
  for (const atlas of safe.atlases) {
    const { bytes } = dataUrlToBytes(atlas.dataUrl);
    textures.push({ path: `atlases/${atlas.id}.png`, bytes });
  }
  // Build the stored document without embedded dataURLs (bytes live as entries).
  const stored = {
    ...safe,
    atlases: safe.atlases.map((a) => ({ ...a, dataUrl: '' })),
  };
  const json = JSON.stringify(stored, null, 2);
  return buildContainer(json, textures);
}

/**
 * Decode a .pvp archive into a validated Project. Throws
 * ContainerError / PayloadError with readable messages for invalid archives.
 * On success the returned Project is fully independent of the input bytes.
 */
export async function decodeProject(bytes: Uint8Array): Promise<Project> {
  const { projectJson, textures } = openContainer(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch (err) {
    throw new PayloadError(
      `project.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new PayloadError('project.json must contain a JSON object');
  }
  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.atlases)) {
    throw new PayloadError('project.json must contain an atlases array');
  }
  // Restore each atlas's embedded dataURL from its PNG entry in the archive.
  const withTextures = {
    ...doc,
    atlases: doc.atlases.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return raw;
      const a = raw as Record<string, unknown>;
      if (typeof a.id !== 'string') return raw;
      const png = textures.get(a.id);
      if (!png) {
        throw new PayloadError(`Project archive is missing the texture for atlas "${a.id}"`);
      }
      return { ...a, dataUrl: bytesToDataUrl(png, 'image/png') };
    }),
  };
  // validateProjectValue deep clones, so nothing aliases the parsed JSON.
  return validateProjectValue(withTextures);
}
