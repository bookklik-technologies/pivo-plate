import { describe, it, expect } from 'vitest';
import { Paintbrush, MousePointer2, Undo2, Eye, Grid2X2, LockOpen, ClipboardPaste } from 'lucide';
import { ICONS, menuGlyph } from '../src/ui/icons';

describe('Lucide UI integration', () => {
  it('uses official icon nodes instead of handwritten SVG paths', () => {
    expect(ICONS.brush).toBe(Paintbrush);
    expect(ICONS.cursor).toBe(MousePointer2);
    expect(ICONS.undo).toBe(Undo2);
    expect(ICONS.eye).toBe(Eye);
    expect(ICONS.grid).toBe(Grid2X2);
    expect(ICONS.unlock).toBe(LockOpen);
  });
  it.each(Object.entries(ICONS))('%s is a nonempty renderable Lucide node', (_name, node) => {
    expect(Array.isArray(node)).toBe(true);
    expect(node.length).toBeGreaterThan(0);
    for (const [tag, attrs] of node) {
      expect(['path','rect','circle','line','polyline','polygon','ellipse']).toContain(tag);
      expect(typeof attrs).toBe('object');
    }
  });
  it('maps document and clipboard menu actions semantically', () => {
    expect(menuGlyph('Open .pvp…')).toBe(ICONS.folder);
    expect(menuGlyph('Save')).toBe(ICONS.save);
    expect(menuGlyph('Paste')).toBe(ClipboardPaste);
    expect(menuGlyph('Frame selection')).toBe(ICONS.expand);
    expect(menuGlyph('Toggle plane lock')).toBe(ICONS.lock);
  });
});
