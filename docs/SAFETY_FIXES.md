# P0 safety and P1 validation/loading remediation

Implemented October 9, 2026 during a targeted stabilization pass. Not every review finding is fixed.

## Fixed

### A01: modal command isolation

Confirmations and Help now use src/ui/modal.ts. The application root is inert while a dialog is open. Focus is trapped in the active dialog, Escape closes it, and previous focus or the viewport is restored. A capture-phase handler stops dialog keystrokes reaching editor commands; global shortcut handling also checks modal state. Opening a modal cancels pending stroke/gizmo previews. Native form editing is preserved inside future dialog fields.

Regression: Ctrl+A/Delete, undo/redo, duplicate, save, mode/camera/plane keys and Tab cannot mutate the editor behind a confirmation. Help has the same protection.

### A02: protected and guarded recovery

Startup atomically copies the stored snapshot into a durable pending-recovery key in the existing IndexedDB store. It does not erase the legacy current key. New current-slot writes, including another tab's save, cannot overwrite the protected copy. The app pauses autosave while recovery is unresolved, and Save still downloads the current document without touching the pending copy.

Restore validates the project, decodes textures and checks dimensions, then checks current unsaved work after asynchronous decoding. Cancel leaves both current work and recovery intact. Accepted restoration resolves only the protected snapshot the user saw. A stale decision from another tab is rejected rather than deleting unrelated data.

Discard requires confirmation. It deletes the current-slot copy only if that exact copy matches the pending snapshot, preserving newer records. An untouched sample scene is not autosaved just because recovery was discarded. Invalid recovery records are kept and can be downloaded as a raw JSON backup rather than automatically cleared.

Autosave writes within this app instance are serialized to keep older asynchronous writes from landing after newer ones. The remaining single current-slot design is not a complete per-document/multi-tab conflict-resolution system. The protected pending slot prevents the audited recovery-loss path.

### A03: atomic atlas metrics

Every transaction validates its raw draft before publication. Invalid tile dimensions or margins throw before project/revision/history/redo/dirty changes. The atlas panel restores the previous valid values, marks the rejected field with aria-invalid and shows feedback. Save and recovery remain usable. Valid settings still enter undo history normally.

### A04: bounded hierarchy validation

A Map-based cached-depth traversal replaces repeated linear parent searches. Root depth is 0; at most 128 ancestor edges are permitted, independent of input ordering. Over-depth files reject rather than truncating. Runtime ancestor queries have defensive cycle/depth guards. A 3,000-object chain is tested in root-first and leaf-first order, and actual file opening rejects it without replacing the current scene.

Very broad/large scenes can still be expensive to render. The depth bound does not certify all large-document performance.

### A09: shared save invariants

src/io/validate.ts is a thin error-class adapter over the canonical core validator. Store construction, replacement, transactions, project save/load, autosave and exports now share document invariants. UVs must lie in 0..1; drift within 1e-6 is normalized. Atlas IDs must match the ZIP-safe [A-Za-z0-9_.-]{1,128} policy. Names, entity references and numeric fields are validated consistently. At most 4095 atlases fit the 4096-entry ZIP budget, reserving one entry for project.json.

Brush regions/quarter-turn flags are checked before tile creation or brush application. Raw UV helper operations may produce a temporary draft outside 0..1, but such a result cannot be committed through EditorStore or persisted; callers should use transactions rather than mutating the public project outside its contract.

Transactions reject asynchronous callbacks. Published state is detached from callback-retained drafts, and canonical normalization is actually published. Invalid replacements preserve the existing document and history. Reordering properties without changing their values no longer creates a transaction because canonical forms are compared.

## Verification

- 239 automated tests across 9 files pass (47 new core safety checks).
- 33 existing Chromium workflow checks pass.
- 15 additional Chromium safety checks pass, including real IndexedDB, downloadable invalid-recovery backup, modal focus isolation and actual over-depth project-file rejection.
- 21 panel/screen-size layout combinations pass.
- Strict typecheck, production build and standalone build pass.

Run npm run test:safety for the native browser safety suite. It starts Vite on strict port 4180 and closes its server/browser after tests. The old workflow suite was updated only to await asynchronous recovery completion rather than assuming a synchronous Restore click.

## Historical scope: open immediately after the safety pass

The later modeling pass resolves Apply Brush UI, Frame selection, hidden-tab fitting, tooltips and normals. See MODELING_FIXES.md; the following paragraph records what was outside the safety pass.

Apply Brush UI wiring, sidebar Frame selection, hidden-tab atlas fitting, plane shortcut tooltips, drag erase/dead HUD cleanup, nonplanar normal generation, complete PNG integrity validation, modeling/animation/rigging parity, and Firefox/Safari qualification remain open. PNG header checks in the core are not a full image decoder; manual Open and Restore perform browser decoding and dimension checks.

Crash durability is still best-effort: a hard crash can lose edits within the debounce window, and browser quota/storage failure can prevent recovery. Downloaded project backups remain recommended. Embedded previews may deny IndexedDB; the app respects that restriction and keeps downloadable saves available.

Canonical validation adds work to each transaction. The software-WebGL 10,000-tile rebuild in this pass measured roughly 340.7 ms, versus approximately 101.7 ms in an earlier less-strict build. These are variable smoke measurements, not a controlled performance comparison or an FPS guarantee.
