import { encodeProject, decodeProject } from './project';
import { exportGLB, exportOBJ } from './export';

self.onmessage = async event => {
  try {
    const { operation, project, bytes, alphaModes } = event.data;
    const value = operation === 'save' ? await encodeProject(project)
      : operation === 'open' ? await decodeProject(bytes)
      : operation === 'glb' ? await exportGLB(project,alphaModes) : await exportOBJ(project,alphaModes);
    self.postMessage({ ok: true, value });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
