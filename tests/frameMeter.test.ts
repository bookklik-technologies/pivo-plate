import {it,expect} from 'vitest';
import {FrameMeter} from '../src/ui/frameMeter';

it('never fabricates a value before a measurement window',()=>{const m=new FrameMeter();expect(m.frame(0)).toBeNull();expect(m.frame(200)).toBeNull();expect(m.frame(999)).toBeNull();});
it('computes actual intervals and mean frame duration',()=>{const m=new FrameMeter();m.frame(0);m.frame(250);m.frame(500);m.frame(750);const s=m.frame(1000)!;expect(s).toEqual({fps:4,frameMs:250,samples:4,windowMs:1000});});
it('supports a 60Hz sequence without a hardcoded FPS',()=>{const m=new FrameMeter();m.frame(0);let sample=null;for(let i=1;i<=60;i++)sample=m.frame(i*1000/60)??sample;expect(sample!.fps).toBeCloseTo(60);expect(sample!.frameMs).toBeCloseTo(1000/60);});
it('long/slow frames lower measured FPS',()=>{const m=new FrameMeter();m.frame(0);m.frame(20);const s=m.frame(1020)!;expect(s.fps).toBeCloseTo(2*1000/1020);expect(s.frameMs).toBe(510);});
it('duplicate timestamps do not add rendered intervals',()=>{const m=new FrameMeter();m.frame(0);m.frame(0);m.frame(500);m.frame(500);expect(m.frame(1000)!.samples).toBe(2);});
it('reset excludes a hidden-page time gap',()=>{const m=new FrameMeter();m.frame(0);m.frame(16);m.reset();expect(m.frame(100000)).toBeNull();expect(m.frame(101000)!.fps).toBe(1);});
it('invalid/backwards timestamps reset rather than emit nonsense',()=>{const m=new FrameMeter();m.frame(100);expect(m.frame(NaN)).toBeNull();expect(m.frame(50)).toBeNull();expect(m.frame(20)).toBeNull();expect(m.frame(30)).toBeNull();});
it('samples use distinct completed windows',()=>{const m=new FrameMeter();m.frame(0);m.frame(500);expect(m.frame(1000)!.samples).toBe(2);m.frame(1250);m.frame(1500);m.frame(1750);expect(m.frame(2000)!.samples).toBe(4);});
it('custom windows are positive finite',()=>{expect(()=>new FrameMeter(0)).toThrow();expect(()=>new FrameMeter(Infinity)).toThrow();const m=new FrameMeter(500);m.frame(0);expect(m.frame(500)!.windowMs).toBe(500);});
