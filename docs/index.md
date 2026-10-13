---
layout: home
titleTemplate: false
title: PiVo Plate Documentation
description: Tutorials, guides, file formats, and API reference for PiVo Plate. Learn to build tiled 3D scenes, edit texture atlases, and export GLB or OBJ.

hero:
  name: "PiVo Plate"
  text: "Browser tile-to-3D modeling editor"
  tagline: "Draw pixel-art tiles on construction planes and turn them into textured 3D geometry — local-first, no account, no backend, no CDN."
  image:
    src: /logo.svg
    alt: PiVo Plate logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Beginner tutorials
      link: /tutorials/
    - theme: alt
      text: User guide
      link: /guide
    - theme: alt
      text: Core & IO API
      link: /api

features:
  - title: Tile drawing on planes
    details: Automatic or locked XZ ground / XY wall / YZ wall construction planes, crosshair depth and numeric XYZ placement, undoable drag erase and preserved panning with a measured FPS HUD.
  - title: Pixel-art atlas
    details: Original procedural pixel-art atlas and a 117-tile sample room, plus your own local PNGs — with pan/zoom, cell/rect picking, tile metrics and brush rotation/flips.
  - title: Real 3D selection & editing
    details: Face/corner and box selection, numeric and gizmo move/rotate/scale, independent corner editing, basic UV operations and undoable Apply Brush.
  - title: Scene hierarchy
    details: Scene objects with face grouping, reparenting, inherited visibility/locking, renaming and confirmed deletion — grouping never changes world coordinates.
  - title: Reliable projects
    details: .pvp ZIP projects with embedded PNG assets, validated save/open, IndexedDB autosave with protected pending recovery, and shared bounded PNG integrity checks.
  - title: Standard exports
    details: Self-contained textured GLB and OBJ/MTL/PNG ZIP exports, independently tested through standard Three.js loaders.
---
