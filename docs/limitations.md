# Limitations & known gaps

PiVo Plate is a desktop-first v0.1 modeling MVP. The following are deliberate, documented limits.

## Not implemented

- Painting, linked prefabs/instances, animation/timelines, rigging, advanced mesh cuts, imported third-party models, FBX/DAE and movie rendering.
- Third-party native file formats are not supported.
- No cloud collaboration or mobile authoring.

## Modeling model

- **Quads have four independent corners and two triangles; no implicit welding.** Coincident corners on other tiles are not implicitly welded.
- Objects are organizational, with **baked world coordinates** — not local transform nodes. Export hierarchy is flattened.
- Object hierarchies are limited to **128 ancestor edges**.
- UVs committed to a document use the 0..1 range (1e-6 drift tolerance); atlas IDs must be ZIP-safe.
- V1 project files reject future versions; automatic version migrations are not yet needed or implemented.

## Performance & storage

- Undo snapshots are bounded to **64** and are O(document size).
- The viewport batches geometry by atlas but rebuilds on edits. A 10,000-tile smoke/stability check passed; **no 30-FPS hardware guarantee** is made.
- Static PNG input is capped at 32 MiB, 16384 px/dimension and 16,777,216 px total; APNG is rejected explicitly. Projects additionally cap aggregate PNG bytes at 64 MiB, pixels at 33,554,432, scanline output at 192 MiB and JSON manifests at 24 MiB.
- Project containers have **96 MB compressed / 128 MB decompressed** safety caps.

## Exports

- In-browser GLB export detects fractional alpha and uses BLEND; cutouts use MASK. Headless GLB exports use the documented MASK default unless a probe is supplied.
- OBJ transparency depends on the importing application's MTL/PNG support.

## Platform

- **Chromium is validated; Firefox/Safari need a manual QA pass.**
- The embedded preview may have different download or storage restrictions than a normal deployed app.
