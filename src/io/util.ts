// Internal helpers shared by src/io modules. Not part of the public IO contract;
// public names live in project.ts / export.ts per docs/CONTRACTS.md.
import { validatePngBytes, pngDataUrlBytes, pngBytesDataUrl, PNG_LIMITS, PROJECT_PNG_LIMITS } from '../core/png';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import type { Project } from '../core/types.ts';

/** Thrown for any readable IO failure (container, autosave, validation). */
export class ProjectIOError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectIOError';
  }
}

/** Container-level failures: bad ZIP, wrong format marker, disallowed paths. */
export class ContainerError extends ProjectIOError {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

/** Thrown when a payload (project.json, embedded PNG) fails validation. */
export class PayloadError extends ProjectIOError {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

/** IndexedDB / storage failures are surfaced as recoverable errors. */
export class StorageError extends ProjectIOError {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Export failures: invalid geometry, no visible content, loader errors. */
export class ExportError extends ProjectIOError {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export function fail(message: string): never {
  throw new ProjectIOError(message);
}

// ---------------------------------------------------------------------------
// Limits / security
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Hard cap on decompressed archive size (defends against zip bombs). */
  maxUncompressed: 128 * 1024 * 1024, // 128 MiB total
  /** Cap per stored file after decompression. */
  maxFileBytes: 96 * 1024 * 1024,
  /** Cap on number of files in a container. */
  maxEntries: 4096,
  /** Cap on the compressed input size accepted by decodeProject. */
  maxCompressed: 96 * 1024 * 1024,
  /** dataURL→PNG conversion limit (embedded textures). */
  maxDataUrlLength: 64 * 1024 * 1024,
  /** Guard while resolving world-space vertices into typed arrays. */
  maxWorldCoord: 1e6,
} as const;

// ---------------------------------------------------------------------------
// dataURL helpers
// ---------------------------------------------------------------------------

/** Decode a data URL into raw bytes and its MIME type. */
export function dataUrlToBytes(dataUrl:string):{bytes:Uint8Array;mime:string} {
  try { const bytes=pngDataUrlBytes(dataUrl);validatePngBytes(bytes);return {bytes,mime:'image/png'}; }
  catch(error){throw new PayloadError(error instanceof Error?error.message:String(error));}
}
export function bytesToDataUrl(bytes:Uint8Array,mime='image/png'):string {
  if(mime!=='image/png')throw new PayloadError('Only PNG texture data URLs are supported');
  try {validatePngBytes(bytes);return pngBytesDataUrl(bytes);}
  catch(error){throw new PayloadError(error instanceof Error?error.message:String(error));}
}
export function isPng(bytes:Uint8Array):boolean {try{validatePngBytes(bytes);return true;}catch{return false;}}

// ---------------------------------------------------------------------------
// ZIP plumbing (container format: .pvp)
// ---------------------------------------------------------------------------

export const FORMAT_MARKER = 'PiVoPlate-Project-Format-v1';

export interface ContainerEntry {
  path: string;
  bytes: Uint8Array;
}

/**
 * Only these path shapes may appear inside a .pvp container:
 *   project.json
 *   atlases/<id>.png
 * Anything else is rejected (zip-slip / path traversal defence).
 */
const ENTRY_PROJECT = 'project.json';
const ATLAS_PREFIX = 'atlases/';
const ATLAS_SUFFIX = '.png';

function safeEntryPath(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 256) return null;
  if (path !== ENTRY_PROJECT) {
    if (!path.startsWith(ATLAS_PREFIX) || !path.endsWith(ATLAS_SUFFIX)) return null;
    const id = path.slice(ATLAS_PREFIX.length, path.length - ATLAS_SUFFIX.length);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) return null;
  }
  return path;
}

/** Build a deterministic .pvp ZIP archive. */
export function buildContainer(projectJson: string, textures: ContainerEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files[ENTRY_PROJECT] = strToU8(projectJson);
  if(textures.length+1>LIMITS.maxEntries||files[ENTRY_PROJECT].length>PROJECT_PNG_LIMITS.maxManifestBytes)throw new ContainerError('Project encoding exceeds manifest/entry budget');
  let total=files[ENTRY_PROJECT].length;
  for (const t of textures) {
    const path = safeEntryPath(t.path);
    if (!path) throw new ContainerError(`Refusing to store unexpected texture path "${t.path}"`);
    total+=t.bytes.length;
    if(t.bytes.length>PNG_LIMITS.maxBytes||total>LIMITS.maxUncompressed)throw new ContainerError('Project encoding exceeds texture/archive budget');
    files[path] = t.bytes;
  }
  const bytes=zipSync(files,{level:6});
  if(bytes.length>LIMITS.maxCompressed)throw new ContainerError('Encoded project exceeds compressed archive budget');
  return bytes;
}

export interface OpenedContainer {
  projectJson: string;
  textures: Map<string, Uint8Array>; // atlasId -> PNG bytes
}

/** Parse and safety-check a .pvp archive. */
export function openContainer(bytes: Uint8Array): OpenedContainer {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ContainerError('Project file is empty or unreadable');
  }
  if (bytes.length > LIMITS.maxCompressed) {
    throw new ContainerError('Project file is too large to open');
  }
  let raw: Record<string, Uint8Array>;
  let declaredTotal = 0, entryCount = 0;
  const seen = new Set<string>();
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        if (++entryCount > LIMITS.maxEntries) throw new ContainerError('Project archive contains too many files');
        if(file.name===ENTRY_PROJECT&&file.originalSize>PROJECT_PNG_LIMITS.maxManifestBytes)throw new ContainerError('Project manifest exceeds byte budget');
        if(file.name.startsWith('atlases/')&&file.originalSize>PNG_LIMITS.maxBytes)throw new ContainerError('PNG archive entry exceeds byte budget');
        if (file.originalSize > LIMITS.maxFileBytes) throw new ContainerError('Archive entry exceeds maximum file size');
        declaredTotal += file.originalSize;
        if (declaredTotal > LIMITS.maxUncompressed) throw new ContainerError('Project archive decompresses to an unreasonably large size');
        if (!safeEntryPath(file.name)) throw new ContainerError(`Project archive contains a disallowed path "${file.name}"`);
        if (seen.has(file.name)) throw new ContainerError('Duplicate ZIP entry');
        seen.add(file.name);
        return true;
      },
    });
  } catch (err) {
    throw new ContainerError(
      `Not a valid .pvp project archive (corrupt or unsupported ZIP): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const names = Object.keys(raw);
  if (names.length === 0) {
    throw new ContainerError('Project archive contains no files');
  }
  if (names.length > LIMITS.maxEntries) {
    throw new ContainerError('Project archive contains too many files');
  }

  let total = 0;
  const textures = new Map<string, Uint8Array>();
  let projectJson: string | undefined;

  for (const name of names) {
    // unzipSync does not include directory placeholders as separate entries by
    // default, but guard anyway: strip trailing slashes and reject empties.
    const clean = name.replace(/\/+$/, '');
    if (clean !== name && clean.length === 0) continue;
    const safe = safeEntryPath(clean);
    if (!safe) {
      throw new ContainerError(
        `Project archive contains a disallowed path "${name}" (expected project.json or atlases/<id>.png)`,
      );
    }
    const data = raw[name];
    if (!data || data.length === 0) {
      throw new ContainerError(`Project archive entry "${safe}" is empty`);
    }
    if (data.length > LIMITS.maxFileBytes) {
      throw new ContainerError(`Project archive entry "${safe}" exceeds the maximum file size`);
    }
    total += data.length;
    if (total > LIMITS.maxUncompressed) {
      throw new ContainerError('Project archive decompresses to an unreasonably large size');
    }
    if (safe === ENTRY_PROJECT) {
      projectJson = strFromU8(data);
    } else {
      const id = safe.slice(ATLAS_PREFIX.length, safe.length - ATLAS_SUFFIX.length);
      try {validatePngBytes(data);}catch(error){throw new ContainerError(`Texture "${safe}" is not a valid PNG image: ${error instanceof Error?error.message:String(error)}`);}
      textures.set(id, data);
    }
  }

  if (projectJson === undefined) {
    throw new ContainerError('Project archive is missing project.json');
  }
  return { projectJson, textures };
}

// ---------------------------------------------------------------------------
// Small structural helpers reused by validators and exporters
// ---------------------------------------------------------------------------

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function failIfBadNumbers(vertex: unknown[], what: string): void {
  for (const v of vertex) {
    if (!isFiniteNumber(v) || Math.abs(v as number) > LIMITS.maxWorldCoord) {
      throw new PayloadError(`${what} contains a non-finite or out-of-range coordinate`);
    }
  }
}

/** Semantic identity of a project, independent of ids the user may have reordered. */
export function deepJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortValue(a)) === JSON.stringify(sortValue(b));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export type { Project };
