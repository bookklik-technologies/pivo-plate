import {describe,it,expect} from 'vitest';
import {readTheme,persistTheme,THEME_KEY,VIEWPORT_PALETTES} from '../src/ui/theme';

describe('theme preference',()=>{
 it('dark remains the default',()=>{expect(readTheme()).toBe('dark');expect(readTheme({getItem:()=>null,setItem:()=>{}})).toBe('dark');});
 it('only the known light value restores light mode',()=>{expect(readTheme({getItem:k=>k===THEME_KEY?'light':null,setItem:()=>{}})).toBe('light');expect(readTheme({getItem:()=>'<invalid>',setItem:()=>{}})).toBe('dark');});
 it('denied read fails safely',()=>{expect(readTheme({getItem:()=>{throw Error('denied');},setItem:()=>{}})).toBe('dark');});
 it('writes only the theme preference key',()=>{let key='',value='';expect(persistTheme('light',{getItem:()=>null,setItem:(k,v)=>{key=k;value=v;}})).toBe(true);expect([key,value]).toEqual([THEME_KEY,'light']);});
 it('denied write and absent storage are nonfatal',()=>{expect(persistTheme('dark')).toBe(false);expect(persistTheme('light',{getItem:()=>null,setItem:()=>{throw Error('quota');}})).toBe(false);});
 it('viewport palettes differ without changing model parameters',()=>{expect(VIEWPORT_PALETTES.dark.background).toBe(0x101418);expect(VIEWPORT_PALETTES.light.background).toBe(0xf2f5f8);expect(VIEWPORT_PALETTES.light.selection).not.toBe(VIEWPORT_PALETTES.dark.selection);});
});
