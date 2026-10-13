import {describe,it,expect,vi,afterEach} from 'vitest';
import {readTheme,persistTheme,THEME_KEY,VIEWPORT_PALETTES} from '../src/ui/theme';

afterEach(()=>vi.unstubAllGlobals());
describe('theme preference',()=>{
 it('follows the system when no valid override exists',()=>{for(const dark of [false,true]){vi.stubGlobal('matchMedia',()=>({matches:dark}));expect(readTheme()).toBe(dark?'dark':'light');expect(readTheme({getItem:()=>'<invalid>',setItem:()=>{}})).toBe(dark?'dark':'light');}});
 it('honors explicit light and dark overrides',()=>{for(const theme of ['light','dark'] as const)expect(readTheme({getItem:()=>theme,setItem:()=>{}})).toBe(theme);});
 it('denied reads still follow system appearance',()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));expect(readTheme({getItem:()=>{throw Error('denied');},setItem:()=>{}})).toBe('dark');});
 it('writes only the theme preference key',()=>{let key='',value='';expect(persistTheme('light',{getItem:()=>null,setItem:(k,v)=>{key=k;value=v;}})).toBe(true);expect([key,value]).toEqual([THEME_KEY,'light']);});
 it('denied write and absent storage are nonfatal',()=>{expect(persistTheme('dark')).toBe(false);expect(persistTheme('light',{getItem:()=>null,setItem:()=>{throw Error('quota');}})).toBe(false);});
 it('viewport palettes differ without changing model parameters',()=>{expect(VIEWPORT_PALETTES.dark.background).toBe(0x101418);expect(VIEWPORT_PALETTES.light.background).toBe(0xf2f5f8);expect(VIEWPORT_PALETTES.light.selection).not.toBe(VIEWPORT_PALETTES.dark.selection);});
});
