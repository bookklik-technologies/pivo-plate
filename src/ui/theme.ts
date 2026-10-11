/** UI-only appearance preference, never part of a Project or undo history. */
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'pivo-plate-theme';
export interface PreferenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export function readTheme(storage?:PreferenceStorage|null):Theme {
  try {const saved=storage?.getItem(THEME_KEY);if(saved==='light'||saved==='dark')return saved;}catch{}return typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}
export function persistTheme(theme:Theme,storage?:PreferenceStorage|null):boolean {
  try {if(!storage)return false;storage.setItem(THEME_KEY,theme);return true;}catch{return false;}
}
export function applyRootTheme(theme:Theme):void {
  const root=document.documentElement;
  root.classList.add('theme-changing');
  root.dataset.theme=theme;
  root.style.colorScheme=theme;
  requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('theme-changing')));
}
export const VIEWPORT_PALETTES = {
  dark:{background:0x101418,grid:0x2c3540,axis:0x4aa8f0,hover:0x4aa8f0,selection:0xb6f04a,cornerIdle:0xe8edf2},
  light:{background:0xf2f5f8,grid:0xc4cdd8,axis:0x1468a0,hover:0x1468a0,selection:0x376e13,cornerIdle:0x334155},
} as const;
