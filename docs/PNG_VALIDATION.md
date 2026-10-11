# Shared PNG integrity and resource validation

## Scope and entry points

src/core/png.ts is the single policy implementation used by canonical document validation, transaction adoption, project encode/decode, autosave inspection/recovery, browser import/image decoding and OBJ/GLB export. Binary ZIP texture entries are checked before becoming atlas data URLs. The UI does not trust MIME type, extension or declared atlas dimensions: it verifies the PNG bytes first, checks project totals, then allocates a browser Image.

File.size bounds are checked before reading import buffers; compressed project size is checked before reading a project file. ZIP entry filters apply PNG and manifest limits before decompression. Raw invalid recovery snapshots remain protected/downloadable rather than being discarded by stricter validation.

## Integrity checks

- PNG signature and first/unique 13-byte IHDR.
- Legal color-type/bit-depth combinations; compression/filter/interlace fields.
- Actual dimensions from IHDR, including pixel and scanline-size calculations.
- Complete bounded chunk framing, chunk-name/reserved-bit checks and CRC32 for every chunk.
- Required/consecutive IDAT and terminal empty IEND, with no trailing bytes.
- Palette/transparency ordering, lengths and index validity for indexed images.
- Unknown critical chunks rejected. Unsupported APNG animation chunks rejected explicitly; use static PNG input.
- Streaming zlib header, DEFLATE completion and Adler32 verification; extra streams/trailers rejected.
- Exact decompressed scanline lengths; filters 0–4 reconstructed; indexed palette values checked after reconstruction.
- Standard PNG color/depth families and Adam7 pass geometry supported.
- Compressed text/profile payloads have independent bounded decompression; selected ancillary chunk grammar/order checked.
- Atlas metadata must exactly match actual PNG dimensions, including cache hits.

The validator consumes image data in 16KiB streaming chunks and retains at most two scanlines per pass, not an entire decoded bitmap. Browser rendering still uses the browser's image decoder after validation. This is image/container integrity validation, not cryptographic authenticity, a complete ICC/color-management semantic validator, a formal security proof, or a promise that every metadata convention renders identically in every browser.

## Hard budgets

| Budget | Limit |
|---|---|
| PNG binary file / texture entry | 32 MiB |
| Actual dimension per axis | 16,384 pixels |
| Actual pixels per image | 16,777,216 |
| Inflated image scanlines per PNG | 192 MiB |
| Chunks per PNG | 4,096 |
| Ancillary input bytes per PNG | 4 MiB |
| Decompressed compressed metadata per PNG | 1 MiB |
| Aggregate PNG binary bytes per project | 64 MiB |
| Aggregate PNG pixels per project | 33,554,432 |
| Aggregate inflated scanlines per project | 192 MiB |
| Project JSON manifest | 24 MiB |
| Outer ZIP compressed input | 96 MiB |
| Outer ZIP decompressed total | 128 MiB |

Project totals are calculated from actual IHDR values in a cheap header/CRC preflight before any texture is inflated, then the full validator checks the textures. Metadata claims cannot reduce the actual budget. Manifest and export packaging gates prevent creating containers outside their supported entry/size budgets. These are per-image/project payload limits, not a bound on total browser heap, all undo snapshots, GPU memory or CPU wall time.

## Cache policy

Only successfully validated immutable data-URL strings are cached, at most 16 entries and 8 MiB of encoded key characters. Expected atlas dimensions are checked again on every cache hit. Mutable byte arrays are always revalidated. Large textures outside the cache budget are rechecked, which can be costly; this is preferable to unbounded memory retention. No FPS/performance guarantee is made.

## Regression coverage

Dedicated unit checks cover legal encodings, Adam7, all filter IDs, split/contiguous IDAT, transparency, metadata, CRC errors, truncation, malformed/duplicate/misordered chunks, missing data/end markers, extra compressed/trailing bytes, wrong filters, palette indices, unsupported animation, dimension spoofing and resource budgets. Base64 oversize checks are verified before decoder invocation; forged huge IHDR and aggregate metadata are rejected before pixel allocations/inflation. ZIP entry budgets are tested before decompression.

Browser regressions verify real canvas PNGs, actual upload rejection without document mutation, no Image allocation for bad/oversized headers, no file-buffer read for oversized upload, failed project loading without replacement, export rejection and invalid recovery retention. Deliberately rejected uploads generate expected nonfatal error logs; there are no unexpected runtime errors in that suite.

Some older test fixtures contained a 1x1 or 2x2 PNG while claiming larger dimensions. Those positive fixtures now contain matching PNGs, and the fixture encoder handles larger scanlines. Negative tests continue to assert rejection; validation was not weakened to keep the fixtures passing.

## Compatibility notes

- Static PNG only; APNG chunks are rejected rather than partially trusting an animated file.
- Older hand-authored or previously accepted projects with corrupt PNGs or spoofed dimensions now reject. Their recovery records are retained for backup/repair.
- Project schema remains version 1; limits and validation are stricter, not silently repaired.
- Pixel art sampling, normal generation and geometric UV editing behavior are unchanged.
- Broader feature coverage, drag erase/HUD cleanup, Safari/Firefox qualification and color-profile equivalence remain separate work.

Run npm run test:png for native browser regressions. The PNG validator uses locally bundled pako 2.2.0 for bounded streaming zlib processing, with MIT/Zlib notices included. No network or CDN is needed at runtime.
