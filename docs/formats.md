# File formats

## Native project format — `.pvp`

Projects are **ZIP containers** (`.pvp`) holding `project.json` plus embedded texture PNGs. Save/open are downloadable; open validation replaces nothing on failure — invalid transactions and replacements are rejected without changing the current project.

- IndexedDB autosave runs with **protected pending recovery**: `inspectAutosave` atomically reserves the durable pending copy and returns empty/valid/invalid with raw backup text, and `resolveRecovery` resolves only that protected copy while preserving newer current records.
- Recovery is optional and is not a substitute for downloadable backups.
- V1 project files **reject future versions**; automatic version migrations are not yet needed or implemented.

## Size & integrity caps

| Cap | Limit |
| --- | --- |
| Static PNG input | 32 MiB, 16384 px/dimension, 16,777,216 px total; APNG rejected explicitly |
| Projects — aggregate PNG bytes | 64 MiB |
| Projects — PNG pixels | 33,554,432 |
| Scanline output | 192 MiB |
| JSON manifests | 24 MiB |
| Project container | 96 MB compressed / 128 MB decompressed |
| Undo snapshots | 64, O(document size) |
| Object hierarchy | 128 ancestor edges |
| UV range | 0..1 with 1e-6 drift tolerance |

Every atlas must match actual validated IHDR dimensions; malformed chunks/CRCs/streams are rejected consistently. The shared bounded PNG CRC/zlib/scanline validation applies across **import, projects, recovery and export**. Atlas IDs must be ZIP-safe (up to 128 characters). Details in [PNG_VALIDATION.md](/PNG_VALIDATION).

## Exports

| Export | Contents |
| --- | --- |
| GLB | Self-contained textured GLB. In-browser export detects fractional alpha and uses **BLEND**; cutouts use **MASK**. Headless exports use the documented MASK default unless a probe is supplied. |
| OBJ bundle | ZIP with `OBJ` + `MTL` + texture PNGs. OBJ transparency depends on the importing application's MTL/PNG support. |

Exports are independently tested through standard Three.js loaders. Export hierarchy is **flattened**; exports never change the source document.

## Not supported

- Painting, linked prefabs/instances, animation/timelines, rigging, advanced mesh cuts, imported third-party models, FBX/DAE and movie rendering are not implemented.
- Third-party native file formats are not supported.
