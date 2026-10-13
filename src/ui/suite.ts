/** Framework-free suite behavior; each application ships its own copy. */
export function positionPopup(anchor:HTMLElement,popup:HTMLElement):void {
  popup.style.position='fixed';popup.style.right='auto';popup.style.bottom='auto';popup.style.maxHeight=Math.max(80,innerHeight-16)+'px';popup.style.overflowY='auto';
  const r=anchor.getBoundingClientRect();
  popup.style.left=Math.max(8,Math.min(r.left,innerWidth-popup.offsetWidth-8))+'px';
  popup.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-popup.offsetHeight-8))+'px';
}
export function positionMenu(details:HTMLDetailsElement):void {
  const summary=details.querySelector('summary'),popup=details.querySelector<HTMLElement>('.suite-menu-popup');
  if(summary&&popup)positionPopup(summary,popup);
}
/** Shared application-menu labels keep shortcut hints decorative. */
export function menuShortcut(label:string,explicit?:string):string {
  const shortcuts:Record<string,string>={'Open project…':'Ctrl+O','Save project':'Ctrl+S','Undo':'Ctrl+Z','Redo':'Ctrl+Shift+Z'};
  const modifier=typeof navigator!=='undefined'&&/Mac/.test(navigator.platform)?'Cmd':'Ctrl';
  return (explicit??shortcuts[label]??'').replace(/Ctrl(?:\/Cmd)?/g,modifier);
}
export function separator():HTMLHRElement {
  const line=document.createElement('hr');line.className='suite-menu-separator';return line;
}
/** Arrow keys move between the four application menus, including portaled popups. */
export function installAppMenuNavigation(nav:HTMLElement):()=>void {
  for(const el of nav.children){if(el instanceof HTMLElement&&el.matches('.suite-menu,.menu-root'))(el.querySelector<HTMLElement>('summary')??el).tabIndex=0;}
  const key=(event:KeyboardEvent)=>{
    if(document.querySelector('dialog[open],[aria-modal="true"]')||nav.closest('[inert]'))return;
    if(!['ArrowLeft','ArrowRight','Escape'].includes(event.key))return;
    const target=event.target;if(!(target instanceof HTMLElement)||target.closest('input,select,textarea'))return;
    const menus=[...nav.children].filter((el):el is HTMLElement=>el instanceof HTMLElement&&el.matches('.suite-menu,.menu-root'));
    const active=menus.find(el=>el.matches('[open],.open'));
    if(event.key==='Escape'){if(!active)return;event.preventDefault();event.stopImmediatePropagation();if(active instanceof HTMLDetailsElement)active.open=false;else active.click();(active.querySelector<HTMLElement>('summary')??active).focus();return;}
    if(!nav.contains(target)&&!(target.closest('.suite-app-menu-popup')&&active))return;
    const current=menus.find(el=>el.contains(target))??active;if(!current)return;
    event.preventDefault();event.stopImmediatePropagation();
    const next=menus[(menus.indexOf(current)+(event.key==='ArrowRight'?1:-1)+menus.length)%menus.length];
    const trigger=next.querySelector<HTMLElement>('summary')??next;
    if(active){if(active instanceof HTMLDetailsElement)active.open=false;else active.classList.remove('open');}
    trigger.focus();
    if(active){if(next instanceof HTMLDetailsElement)next.open=true;else next.click();trigger.focus();}
  };
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
}
export function menu(label:string, items:HTMLElement[]):HTMLDetailsElement {
  const buttons=items.filter((item):item is HTMLButtonElement=>item instanceof HTMLButtonElement);
  const application=['File','Edit','View','Help'].includes(label);
  if(application)for(const button of buttons){
    const text=button.textContent??'';button.setAttribute('aria-label',button.getAttribute('aria-label')??text);
    const name=document.createElement('span');name.className='suite-menu-label';name.textContent=text;
    const hint=document.createElement('span');hint.className='suite-menu-hint';hint.setAttribute('aria-hidden','true');hint.textContent=menuShortcut(text);button.replaceChildren(name,hint);
  }
  const details=document.createElement('details'); details.className='suite-menu';details.dataset.suiteManaged='true';
  const summary=document.createElement('summary');summary.textContent=label;
  const popup=document.createElement('div');popup.className='suite-menu-popup'+(application?' suite-app-menu-popup':'');
  details.append(summary,popup);popup.append(...items);
  details.addEventListener('toggle',()=>{if(details.open){positionMenu(details);for(const other of document.querySelectorAll<HTMLDetailsElement>('.suite-menu[open]'))if(other!==details)other.open=false;}});
  popup.addEventListener('click',e=>{if((e.target as Element).closest('button:not(:disabled)')){details.open=false;summary.focus();}},true);
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

/** Readable shortcut labels shared by references and tool hints; binding data stays unchanged. */
export function shortcutLabel(value:string):string {
 const mod=/Mac|iPhone|iPad/.test(navigator.platform)?'Cmd':'Ctrl';
 return value.replace(/Ctrl\/Cmd|Mod(?=\+)/g,mod).replace(/\bKey([A-Z])\b/g,'$1').replace(/\bDigit([0-9])\b/g,'$1')
  .replace(/\bComma\b/g,',').replace(/\bPeriod\b/g,'.').replace(/\bEsc\b/g,'Escape').replace(/\bDel\b/g,'Delete')
  .replace(/\bMMB\b/g,'Middle mouse').replace(/\bRMB\b/g,'Right mouse').replace(/\bLMB\b/g,'Left mouse');
}
export function shortcutTable(rows:ReadonlyArray<readonly [string,string]>):string {
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 return `<table class="suite-shortcut-table"><thead><tr><th scope="col">Shortcut</th><th scope="col">Action</th></tr></thead><tbody>${rows.map(([keys,action])=>`<tr><th scope="row"><kbd>${escape(shortcutLabel(keys))}</kbd></th><td>${escape(action)}</td></tr>`).join('')}</tbody></table>`;
}
