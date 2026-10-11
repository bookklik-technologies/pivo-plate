/** Modal focus and command isolation shared by confirmations and Help. */
let serial = 0;
export function isModalOpen(): boolean { return !!document.querySelector('.modal-overlay'); }
function topModal(): Element | null { return [...document.querySelectorAll('.modal-overlay')].at(-1) ?? null; }

export function mountModal(overlay: HTMLElement, box: HTMLElement, initialFocus?: HTMLElement): () => void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const app = document.getElementById('app');
  const title = box.querySelector('h3');
  box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true'); box.tabIndex = -1;
  if(title instanceof HTMLElement) { title.id ||= `dialog-title-${++serial}`; box.setAttribute('aria-labelledby',title.id); }
  let closed = false;
  const focusables = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden');
  const focusFirst = (): void => (initialFocus?.isConnected ? initialFocus : focusables()[0] ?? box).focus({preventScroll:true});
  const close = (): void => {
    if(closed) return; closed = true;
    overlay.remove();
    window.removeEventListener('keydown',key,true);
    document.removeEventListener('focusin',keepFocus,true);
    if(app) app.inert = isModalOpen();
    if(!isModalOpen()) {
      if(previous?.isConnected && previous!==document.body && !previous.closest('[inert]')) previous.focus({preventScroll:true});
      else document.querySelector<HTMLElement>('#viewport-host > canvas')?.focus({preventScroll:true});
    } else (topModal()?.querySelector<HTMLElement>('[role="dialog"]'))?.focus({preventScroll:true});
  };
  const key = (e: KeyboardEvent): void => {
    if(topModal()!==overlay) return;
    e.stopPropagation();
    if(e.key==='Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if(e.key==='Tab') {
      e.preventDefault();
      const items=focusables(); if(!items.length) {box.focus();return;}
      const i=items.indexOf(document.activeElement as HTMLElement);
      const next=e.shiftKey ? (i<=0?items.length-1:i-1) : (i<0||i===items.length-1?0:i+1);
      items[next].focus(); return;
    }
    // Prevent browser/app save/open/selection shortcuts, but preserve native
    // text editing if a future modal contains an editable form field.
    const target=e.target as HTMLElement|null;
    const editable=target?.isContentEditable || !!target?.matches('input,textarea,select');
    if((e.ctrlKey||e.metaKey) && (!editable || !['a','c','v','x','z','y'].includes(e.key.toLowerCase()))) e.preventDefault();
  };
  const keepFocus = (e: FocusEvent): void => {
    if(topModal()===overlay && e.target instanceof Node && !box.contains(e.target)) focusFirst();
  };
  overlay.addEventListener('pointerdown',e=>{ if(e.target===overlay) close(); });
  document.body.append(overlay);
  if(app) app.inert=true;
  window.addEventListener('keydown',key,true);
  document.addEventListener('focusin',keepFocus,true);
  window.dispatchEvent(new Event('pivo-plate-modal-open'));
  focusFirst();
  return close;
}
