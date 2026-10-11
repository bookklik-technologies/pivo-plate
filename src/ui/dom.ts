import { mountModal } from './modal';
export { isModalOpen, mountModal } from './modal';
import { ICONS, svgIcon, type Glyph } from './icons';
export { ICONS, svgIcon, type Glyph } from './icons';

/** Minimal DOM helper used by the PiVo Plate shell. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
      } else if (k === 'html') el.innerHTML = String(v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function div(cls: string, ...children: (Node | string | null | undefined | false)[]): HTMLDivElement {
  return h('div', { class: cls }, ...children);
}

/** Same as div() but children come after attribute children of h(). */
export function divAttrs(cls: string, attrs: Record<string, unknown>, ...children: (Node | string | null | undefined | false)[]): HTMLDivElement {
  return h('div', { class: cls, ...attrs }, ...children);
}

export function button(
  cls: string,
  label: string,
  title?: string,
): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, title }, label);
}

export function iconButton(cls: string, glyph: Glyph, title: string): HTMLButtonElement {
  const b = button(`${cls} tb-icon-btn`, '', title);
  b.setAttribute('aria-label', title);
  b.append(svgIcon(glyph));
  return b;
}

export function sliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
  format?: (v: number) => string,
): HTMLElement {
  const out = h('span', { class: 'slider-val' }, (format ?? String)(value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = (format ?? String)(v);
    onInput(v);
  });
  const row = h('label', { class: 'slider-row' }, h('span', { class: 'slider-label' }, label), input, out);
  row.dataset.input = 'true';
  return row;
}

export function checkRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const row = h('label', { class: 'check-row' }, input, h('span', null, label));
  row.dataset.input = 'true';
  return row;
}

/** Generic confirmation modal. onConfirm receives true. */
export function confirmModal(
  title: string,
  body: string | HTMLElement,
  confirmLabel: string,
  onConfirm: () => void,
  opts?: { danger?: boolean },
): void {
  const overlay = div('modal-overlay');
  const box = div('modal-box');
  box.append(h('h3', { class: 'modal-title' }, title));
  if (typeof body === 'string') box.append(h('p', { class: 'modal-body' }, body));
  else box.append(body);
  const row = div('modal-actions');
  const cancel = button('btn', 'Cancel');
  const ok = button(opts?.danger ? 'btn btn-danger' : 'btn btn-primary', confirmLabel);
  row.append(cancel, ok);
  box.append(row);
  overlay.append(box);
  const close = mountModal(overlay,box,ok);
  cancel.addEventListener('click',close);
  ok.addEventListener('click',()=>{ close(); onConfirm(); });

}

/** Nonfatal error toast; also logged for diagnostics. */
export function toastError(err: unknown, context: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[PiVo Plate] ${context}:`, err);
  toast(`${context}: ${msg}`, 'error');
}

export function toast(msg: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = div(`toast toast-${kind}`, h('span', null, msg));
  const x = iconButton('toast-x', ICONS.cross, 'Dismiss');
  x.addEventListener('click', () => t.remove());
  t.append(x);
  host.append(t);
  window.setTimeout(() => t.remove(), kind === 'error' ? 9000 : 5000);
}

