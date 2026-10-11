# Outfit UI typography

Outfit is the primary UI font through @fontsource-variable/outfit 5.3.0. Its Outfit Variable family is declared first in the shared sans-serif token, so headings, menus, tabs, buttons, dialogs and standard labels use the requested face. Variable weight 100–900 supports the existing 400/450/500/600/650/700 UI weights without separate static downloads.

## Refined scale and weights

- General Outfit body: 13.5px / 400, with 1.5 line height.
- Main controls: 12.5px / 500; selected/emphasized actions use 600.
- Labels and captions: 12px; labels use 500, explanatory hints use 400 and 1.5 line height.
- Section headings: 12px / 650, reduced tracking (0.085em) and stronger text contrast.
- Translation/Rotation/Scale subheadings: 13px / 600, sentence-case emphasis.
- Modal titles: 18px / 650, 1.3 line height; modal content: 13.5px with relaxed leading.
- Sidebar tabs: 12px / 600. Technical HUD/status values: 11px monospace.

Sizes and role weights are centralized in CSS type tokens rather than independent tiny text declarations. Control heights and sidebar widths stay unchanged; labels gain emphasis without making every element bold. Both light and dark modes use the same hierarchy. The FPS/history chip cap was increased slightly to accommodate the clearer technical size.

Technical number fields, coordinates, keyboard/readout columns and FPS/status diagnostics retain the existing monospace token. Atlas pixels, geometry, themes, camera state, document data and undo history are not changed by this appearance update.

The Latin and Latin-extended WOFF2 subsets are installed locally and embedded as data font assets by Vite in the standalone HTML. Runtime font-CDN requests are not needed. Unsupported script glyphs use normal system fallbacks. Font display uses swap; loading/fallback behavior does not make the editor depend on a remote font service.

The official SIL Open Font License 1.1 and Outfit Project Authors notice are included in docs/licenses/outfit-OFL-1.1.txt and standalone attribution. No font files were modified or renamed internally. The font is not an original application asset; upstream attribution is retained.

Verification: native browser tests wait for actual font-face loading, exercise 400/450/500/600/650/700 weights and Latin-extended text, check loaded FontFace records, verify UI versus technical-monospace computed families, check all tabs in dark/light themes, exercise menu/Help safety and assert no external font requests. Existing 21 viewport/panel layout combinations pass. Source includes npm run test:font and docs/font-report.json.

This is a typography update, not full locale or accessibility certification. Bundled subsets cover the package's declared Unicode ranges; other scripts use fallbacks. Further roadmap work remains separate.
