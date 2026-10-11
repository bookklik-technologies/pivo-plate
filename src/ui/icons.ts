/** Locally bundled Lucide icons; import named nodes for tree-shaking. */
import {
  createElement, MousePointer2, Box, Grid2X2, PanelsTopLeft, Move,
  RotateCw, Scaling, Trash2, Undo2, Redo2, Save, FolderOpen,
  Download, Upload, Eye, EyeOff, Lock, LockOpen, Plus, Camera,
  Image, Paintbrush, Eraser, CircleHelp, X, Copy, CopyPlus, FlipHorizontal2,
  Maximize2, Crosshair, PanelRight, Keyboard, TriangleAlert,
  Layers, SlidersHorizontal, FilePlus2, ClipboardPaste, ArrowLeftRight, Info, Sun, Moon,
  type IconNode,
} from 'lucide';

export type Glyph = IconNode;
export const ICONS = {
  cursor: MousePointer2, cube: Box, grid: Grid2X2, plane: PanelsTopLeft,
  move: Move, rotate: RotateCw, scale: Scaling, trash: Trash2,
  undo: Undo2, redo: Redo2, save: Save, folder: FolderOpen,
  download: Download, upload: Upload, eye: Eye, eyeOff: EyeOff,
  lock: Lock, unlock: LockOpen, plus: Plus, camera: Camera,
  image: Image, brush: Paintbrush, erase: Eraser, question: CircleHelp, cross: X,
  copy: Copy, clone: CopyPlus, flip: FlipHorizontal2, expand: Maximize2,
  target: Crosshair, sidebar: PanelRight, keyboard: Keyboard,
  warning: TriangleAlert, layers: Layers, properties: SlidersHorizontal,
  sun:Sun,moon:Moon,newFile: FilePlus2, paste: ClipboardPaste, reverse: ArrowLeftRight, info: Info,
} as const;

/** Decorative SVG: its containing button/text supplies the accessible name. */
export function svgIcon(icon: Glyph, size = 16): SVGSVGElement {
  return createElement(icon, {
    width: size, height: size, stroke: 'currentColor', 'stroke-width': 2,
    class: 'lucide', 'data-icon-library': 'lucide',
    'aria-hidden': 'true', focusable: 'false',
  }) as SVGSVGElement;
}

export function menuGlyph(label: string): Glyph {
  if(label==='Light theme')return ICONS.sun;
  if(label==='Dark theme')return ICONS.moon;
  if (label.startsWith('New')) return ICONS.newFile;
  if (label.startsWith('Sample')) return ICONS.cube;
  if (label.startsWith('Open')) return ICONS.folder;
  if (label === 'Save') return ICONS.save;
  if (/^(Download|Export)/.test(label)) return ICONS.download;
  if (label.startsWith('Import')) return ICONS.upload;
  if (label === 'Undo') return ICONS.undo;
  if (label === 'Redo') return ICONS.redo;
  if (label === 'Duplicate') return ICONS.clone;
  if (label === 'Copy') return ICONS.copy;
  if (label === 'Paste') return ICONS.paste;
  if (label === 'Delete') return ICONS.trash;
  if (label==='Apply Brush') return ICONS.brush;
  if (label.startsWith('Reverse')) return ICONS.reverse;
  if (label.startsWith('Perspective')) return ICONS.camera;
  if (label.startsWith('Frame')) return ICONS.expand;
  if (label.startsWith('Plane')) return ICONS.plane;
  if (label.includes('plane lock')) return ICONS.lock;
  if (label.startsWith('Shortcuts')) return ICONS.keyboard;
  return ICONS.info;
}
