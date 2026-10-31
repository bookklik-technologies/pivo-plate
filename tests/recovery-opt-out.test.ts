import { afterEach, expect, it, vi } from 'vitest';
import { createProject } from '../src/core/editor';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(['?recovery=off', '?embed=1&recovery=on'])('does not read, write, migrate, or discard browser backups: %s', async search => {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  const access = vi.fn(() => { throw new Error('Unexpected recovery storage access'); });
  vi.stubGlobal('localStorage', { getItem: access, removeItem: access });
  vi.stubGlobal('indexedDB', { open: access });
  const storage = await import('../src/io/project');
  await storage.saveAutosave(createProject());
  expect(await storage.listRecoveryCopies()).toEqual([]);
  expect(await storage.inspectAutosave()).toEqual({ status: 'empty', raw: null });
  expect(await storage.loadAutosave()).toBeNull();
  await storage.clearAutosave();
  await storage.flushRecoveryStorage();
  await expect(storage.resolveRecovery('{}')).rejects.toThrow(/disabled/);
  expect(access).not.toHaveBeenCalled();
});
