import { createProject, validateProject, type Project } from './core.js';

function normalize(project: Project): Project {
  return validateProject(project);
}

export interface HeadlessEditor {
  getProject(): Project;
  transact(mutate: (draft: Project) => void): void;
  replace(project: Project): void;
}

export function createHeadlessEditor(initialProject: Project = createProject()): HeadlessEditor {
  let current = normalize(initialProject);
  let transacting = false;

  function assertIdle(): void {
    if (transacting) throw new Error('Headless editor mutations cannot be nested');
  }

  return {
    getProject() {
      return structuredClone(current);
    },
    transact(mutate) {
      assertIdle();
      transacting = true;
      try {
        const draft = structuredClone(current);
        const result: unknown = mutate(draft);
        if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw new Error('Headless editor transactions must be synchronous');
        }
        current = normalize(draft);
      } finally {
        transacting = false;
      }
    },
    replace(project) {
      assertIdle();
      current = normalize(project);
    },
  };
}
