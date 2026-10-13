import type { Project } from '../core/types';
import { runWorker, prepareWorker } from '../ui/suite-worker';
import workerURL from './archive.worker?worker&url';
if (!import.meta.env.DEV) void prepareWorker(workerURL).catch(() => {});

export async function archiveAsync<T>(operation: 'save' | 'open' | 'glb' | 'obj', payload: Project | Uint8Array, label?: string, alphaModes?:Map<string,'opaque'|'cutout'|'blend'>): Promise<T> {
  return runWorker<T>(workerURL, { operation, alphaModes, ...(payload instanceof Uint8Array ? { bytes: payload } : { project: payload }) }, label);
}
