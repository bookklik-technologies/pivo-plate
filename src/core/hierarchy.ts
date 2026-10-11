// Bounded hierarchy helpers for PiVo Plate (renderer-independent core).
// All helpers walk parent chains defensively: invalid runtime graphs (cycles,
// unknown parents, excessive depth) produce readable thrown errors instead of
// hangs. Valid graphs are processed with linear-time algorithms using cached
// depths so whole-hierarchy queries stay O(n) even under deep trees.
import type { Project, SceneObject } from './types.ts';

/** Hard cap on parent-chain depth for any object in a valid project. */
export const MAX_HIERARCHY_DEPTH = 128;

function depthError(id: string): Error {
  return new Error(
    `Object "${id}" exceeds the maximum hierarchy depth of ${MAX_HIERARCHY_DEPTH}`,
  );
}

/**
 * Ancestors of `id`, nearest parent first (id itself excluded).
 * Throws a readable error on unknown ids, cycles, or over-deep chains —
 * unlike tolerant walkers, an invalid runtime graph must fail loudly.
 */
export function ancestorChain(objects: SceneObject[], id: string): SceneObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  if (!byId.has(id)) throw new Error(`ancestorChain: unknown object id "${id}"`);
  const chain: SceneObject[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)!.parentId;
  while (cur !== null) {
    if (chain.length >= MAX_HIERARCHY_DEPTH) throw depthError(id);
    const parent = byId.get(cur);
    if (!parent) throw new Error(`ancestorChain: object "${id}" references unknown parent "${cur}"`);
    if (seen.has(parent.id)) {
      throw new Error(`ancestorChain: object hierarchy contains a cycle at "${parent.id}"`);
    }
    seen.add(parent.id);
    chain.push(parent);
    cur = parent.parentId;
  }
  return chain;
}

/** Compute depth for every object in one linear pass; returns id → depth. */
export function objectDepths(objects: SceneObject[]): Map<string, number> {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const depths = new Map<string, number>();
  for (const o of objects) {
    if (depths.has(o.id)) continue;
    // Walk up collecting the uncomputed part of the chain, then assign depths
    // back down. `seen` guards against cycles; pending is bounded by the
    // depth cap so over-deep chains are rejected in bounded time.
    const pending: SceneObject[] = [];
    const seen = new Set<string>();
    let cur: SceneObject | undefined = o;
    while (cur && !depths.has(cur.id)) {
      if (seen.has(cur.id)) {
        throw new Error(`object hierarchy contains a cycle at "${cur.id}"`);
      }
      seen.add(cur.id);
      if (pending.length > MAX_HIERARCHY_DEPTH) throw depthError(o.id);
      pending.push(cur);
      if (cur.parentId === null) { cur = undefined; break; }
      const parent = byId.get(cur.parentId);
      if (!parent) {
        throw new Error(`object "${cur.id}" references unknown parent "${cur.parentId}"`);
      }
      cur = parent;
    }
    // The first pending node sits one level BELOW the stop node: when the
    // walk ended on a computed ancestor its depth is that ancestor's + 1;
    // when it ended at a root (cur === undefined) the last pending node is
    // the root itself at depth 0.
    let base = cur ? depths.get(cur.id)! + 1 : 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (base > MAX_HIERARCHY_DEPTH) throw depthError(pending[i]!.id);
      depths.set(pending[i]!.id, base);
      base++;
    }
  }
  return depths;
}

/**
 * isObjectVisible over an arbitrary object list (export-source variant):
 * true only when the object and every ancestor are visible. Throws on
 * unknown ids or invalid graphs, matching the strict helpers above.
 */
export function isObjectVisibleValue(project: Project, id: string): boolean {
  const chain = ancestorChain(project.objects, id);
  const self = project.objects.find((o) => o.id === id);
  if (!self) throw new Error(`isObjectVisibleValue: unknown object id "${id}"`);
  return chain.every((o) => o.visible) && self.visible;
}

/**
 * isObjectLocked over an arbitrary object list (export-source variant):
 * true when the object or any ancestor is locked. Throws on unknown ids or
 * invalid graphs, matching the strict helpers above.
 */
export function isObjectLockedValue(project: Project, id: string): boolean {
  const chain = ancestorChain(project.objects, id);
  const self = project.objects.find((o) => o.id === id);
  if (!self) throw new Error(`isObjectLockedValue: unknown object id "${id}"`);
  return chain.some((o) => o.locked) || self.locked;
}
