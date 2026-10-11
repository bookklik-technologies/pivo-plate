/** Visible rendered-frame window measurement; independent of timers/DOM. */
export interface FrameSample {fps:number;frameMs:number;samples:number;windowMs:number}
export class FrameMeter {
  private start:number|null=null;
  private previous:number|null=null;
  private count=0;
  constructor(private readonly windowMs=1000){if(!Number.isFinite(windowMs)||windowMs<=0)throw new Error('Invalid frame measurement window');}
  reset():void{this.start=null;this.previous=null;this.count=0;}
  frame(timestamp:number):FrameSample|null {
    if(!Number.isFinite(timestamp)||timestamp<0){this.reset();return null;}
    if(this.previous!==null&&timestamp<this.previous){this.reset();}
    if(this.start===null){this.start=timestamp;this.previous=timestamp;return null;}
    if(timestamp===this.previous)return null;
    this.previous=timestamp;this.count++;
    const elapsed=timestamp-this.start;
    if(elapsed<this.windowMs)return null;
    const result={fps:this.count*1000/elapsed,frameMs:elapsed/this.count,samples:this.count,windowMs:elapsed};
    this.start=timestamp;this.count=0;return result;
  }
}
