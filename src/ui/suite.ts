/** Framework-free suite behavior; each application ships its own copy. */
export function positionPopup(anchor:HTMLElement,popup:HTMLElement):void {
  popup.style.position='fixed';popup.style.maxHeight=Math.max(80,innerHeight-16)+'px';popup.style.overflowY='auto';
  const r=anchor.getBoundingClientRect();
  popup.style.left=Math.max(8,Math.min(r.left,innerWidth-popup.offsetWidth-8))+'px';
  popup.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-popup.offsetHeight-8))+'px';
}
export function positionMenu(details:HTMLDetailsElement):void {
  const summary=details.querySelector('summary'),popup=details.querySelector<HTMLElement>('.suite-menu-popup');
  if(summary&&popup)positionPopup(summary,popup);
}
export function menu(label:string, buttons:HTMLButtonElement[]):HTMLDetailsElement {
  const details=document.createElement('details'); details.className='suite-menu';details.dataset.suiteManaged='true';
  const summary=document.createElement('summary');summary.textContent=label;
  const popup=document.createElement('div');popup.className='suite-menu-popup';
  details.append(summary,popup);popup.append(...buttons);
  details.addEventListener('toggle',()=>{if(details.open){positionMenu(details);for(const other of document.querySelectorAll<HTMLDetailsElement>('.suite-menu[open]'))if(other!==details)other.open=false;}});
  popup.addEventListener('click',e=>{if((e.target as Element).closest('button:not(:disabled)'))details.open=false;});
  details.addEventListener('keydown',e=>{
    const items=buttons.filter(b=>!b.disabled&&!b.hidden),index=items.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();details.open=false;summary.focus();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();details.open=true;const next=e.key==='Home'?0:e.key==='End'?items.length-1:index<0?(e.key==='ArrowDown'?0:items.length-1):(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}
  });
  document.addEventListener('pointerdown',e=>{if(!details.contains(e.target as Node))details.open=false;});
  return details;
}
export function action(label:string,run:()=>void):HTMLButtonElement {
  const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=run;return button;
}
/** Same visibility and Escape behavior for desktop docks and compact overlays. */
export function installDockToggle(button:HTMLButtonElement,dock:HTMLElement):()=>void {
  const narrow=matchMedia('(max-width:880px)');
  const workspace=dock.closest<HTMLElement>('.workspace,#workspace,.app-main')??dock.parentElement;
  const visible=()=>!dock.hidden&&(narrow.matches?dock.classList.contains('suite-dock-open'):!dock.classList.contains('suite-dock-hidden'));
  const sync=()=>{button.setAttribute('aria-expanded',String(visible()));button.disabled=dock.hidden;if(dock.hidden)button.title='The right dock is empty. Use View to access your customized panels.';else button.title='Toggle panels';if(workspace)dock.style.setProperty('--pivo-dock-top',workspace.getBoundingClientRect().top+'px');};
  const toggle=()=>{dock.classList.toggle(narrow.matches?'suite-dock-open':'suite-dock-hidden');sync();};
  const escape=(e:KeyboardEvent)=>{
    if(e.key!=='Escape'||!narrow.matches||!visible()||document.querySelector('dialog[open],[aria-modal="true"],.suite-menu[open],.menu-root.open'))return;
    e.preventDefault();e.stopImmediatePropagation();dock.classList.remove('suite-dock-open');sync();button.focus();
  };
  const size=new ResizeObserver(sync);if(workspace)size.observe(workspace);
  const state=new MutationObserver(sync);state.observe(dock,{attributes:true,attributeFilter:['class','hidden']});
  button.addEventListener('click',toggle);narrow.addEventListener('change',sync);document.addEventListener('keydown',escape,true);sync();
  return()=>{button.removeEventListener('click',toggle);narrow.removeEventListener('change',sync);document.removeEventListener('keydown',escape,true);size.disconnect();state.disconnect();};
}
export function tabKeys(list:HTMLElement):()=>void {
  const key=(e:KeyboardEvent)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    const tabs=[...list.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    const i=tabs.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;e.preventDefault();
    const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next]?.click();tabs[next]?.focus();
  };list.addEventListener('keydown',key);return()=>list.removeEventListener('keydown',key);
}
export function resize(handle:HTMLElement,host:HTMLElement,property:string,initial:number,min:number,max:number,key:string,axis:'x'|'y'='y',direction=1):()=>void {
  let value=initial;try{const saved=Number(localStorage.getItem(key));if(saved>=min&&saved<=max)value=saved;}catch{}
  const apply=()=>{host.style.setProperty(property,value+'px');handle.setAttribute('aria-valuenow',String(value));};
  const save=()=>{try{localStorage.setItem(key,String(value));}catch{}};
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',axis==='y'?'horizontal':'vertical');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
  let start=0,baseline=0,id:number|null=null;
  const down=(e:PointerEvent)=>{id=e.pointerId;start=axis==='x'?e.clientX:e.clientY;baseline=value;handle.setPointerCapture(id);e.preventDefault();};
  const move=(e:PointerEvent)=>{if(e.pointerId!==id)return;value=Math.round(Math.max(min,Math.min(max,baseline+((axis==='x'?e.clientX:e.clientY)-start)*direction)));apply();};
  const up=()=>{id=null;save();};const cancel=()=>{id=null;value=baseline;apply();};
  const keyboard=(e:KeyboardEvent)=>{const delta=e.key===(axis==='x'?'ArrowRight':'ArrowDown')?10:e.key===(axis==='x'?'ArrowLeft':'ArrowUp')?-10:0;if(delta||e.key==='Home'||e.key==='End'){e.preventDefault();value=e.key==='Home'?min:e.key==='End'?max:Math.max(min,Math.min(max,value+delta));apply();save();}};
  handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',cancel);handle.addEventListener('keydown',keyboard);apply();
  return ()=>{handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('keydown',keyboard);};
}

/** Settings disclosures share dismissal and viewport-safe positioning. */
export function installDisclosureMenus(root:Document=document):()=>void {
 const toggle=(event:Event)=>{const el=event.target;if(!(el instanceof HTMLDetailsElement)||!el.matches('.suite-menu:not([data-suite-managed])')||!el.open)return;for(const other of root.querySelectorAll<HTMLDetailsElement>('.suite-menu[open]'))if(other!==el)other.open=false;positionMenu(el);};
 const key=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;const el=(e.target as HTMLElement).closest<HTMLDetailsElement>('.suite-menu[open]:not([data-suite-managed])');if(el){e.preventDefault();e.stopPropagation();el.open=false;el.querySelector('summary')?.focus();}};
 const outside=(e:PointerEvent)=>{for(const el of root.querySelectorAll<HTMLDetailsElement>('.suite-menu[open]:not([data-suite-managed])'))if(!el.contains(e.target as Node))el.open=false;};
 root.addEventListener('toggle',toggle,true);root.addEventListener('keydown',key);root.addEventListener('pointerdown',outside);return()=>{root.removeEventListener('toggle',toggle,true);root.removeEventListener('keydown',key);root.removeEventListener('pointerdown',outside);};
}
