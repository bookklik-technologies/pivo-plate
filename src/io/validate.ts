// Validation for Project payloads inside .pvp containers, and for GLB/OBJ
// export sources. This module is a thin IO adapter over the ONE canonical
// validator in src/core/editor.ts (validateProject). All semantic rules —
// budgets, references, UV range, atlas id pattern, hierarchy depth — live
// there exactly once; duplicates here would drift.
//
// IO-specific behavior preserved per contract:
//   - errors surface as PayloadError (readable IO failure class)
//   - familiar message shapes are kept where tests/UX rely on them
//     ('own parent', 'unknown atlas'/'object' refs, 'outside the 0..1 range')
//   - validateProjectValue validates + deep clones + throws readable errors
//   - ancestorChain / isObjectVisibleValue / isObjectLockedValue re-exported
//     from core hierarchy helpers.
import { validateProject } from '../core/editor';
import {
  ancestorChain as coreAncestorChain,
  isObjectVisibleValue as coreIsVisible,
  isObjectLockedValue as coreIsLocked,
  MAX_HIERARCHY_DEPTH,
} from '../core/hierarchy';
import type { Project, SceneObject } from '../core/types.ts';
import { PayloadError } from './util.ts';

export { MAX_HIERARCHY_DEPTH } from '../core/hierarchy';

/**
 * validateProject per IO contract: validates, deep clones, throws readable
 * PayloadError. A thin wrapper — the canonical validator in core/editor.ts
 * does the real work; this only re-labels errors as PayloadError so callers
 * can catch IO-class failures.
 */
export function validateProjectValue(value: unknown): Project {
  try {
    return validateProject(value);
  } catch (err) {
    throw new PayloadError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Ancestors of `id`, nearest parent first (id itself excluded). Over a raw
 * runtime object list this now throws a readable PayloadError on unknown
 * ids, cycles, or over-deep chains instead of silently returning a partial
 * chain. Kept on the IO surface for export-source compatibility.
 */
export function ancestorChain(objects: SceneObject[], id: string): SceneObject[] {
  try {
    return coreAncestorChain(objects, id);
  } catch (err) {
    throw new PayloadError(err instanceof Error ? err.message : String(err));
  }
}

/** isObjectVisible per contract: ancestors included. Throws on invalid graphs. */
export function isObjectVisibleValue(project: Project, id: string): boolean {
  try {
    return coreIsVisible(project, id);
  } catch (err) {
    throw new PayloadError(err instanceof Error ? err.message : String(err));
  }
}

/** isObjectLocked per contract: ancestors included. Throws on invalid graphs. */
export function isObjectLockedValue(project: Project, id: string): boolean {
  try {
    return coreIsLocked(project, id);
  } catch (err) {
    throw new PayloadError(err instanceof Error ? err.message : String(err));
  }
}
