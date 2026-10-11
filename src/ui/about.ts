// PiVo Plate — About dialog. Same structure as the other PiVo editors; the
// description, version and license lines come from package.json via Vite define.
import { button, div, h, mountModal } from './dom';

declare const __APP_VERSION__: string;
declare const __APP_DESCRIPTION__: string;

export function showAboutModal(): void {
  const body = h('div', { class: 'modal-body' });
  body.innerHTML = `
  <p>${__APP_DESCRIPTION__}</p>
  <p><b>Version</b> ${__APP_VERSION__}</p>
  <p><b>License</b> MIT. Copyright (c) 2026 Bookklik Technologies.</p>
  <p><b>Privacy</b> Everything runs in your browser. Nothing is uploaded and no account is needed; files stay on this device unless you download them.</p>
  <p><b>Limitations</b> A functioning modeling MVP, not a complete v1 feature set. Requires WebGL2.</p>`;
  const overlay = div('modal-overlay');
  const box = div('modal-box');
  const actions = div('modal-actions');
  const close = button('btn btn-primary', 'Close');
  actions.append(close);
  box.append(h('h3', { class: 'modal-title' }, 'About PiVo Plate'), body, actions);
  overlay.append(box);
  const closeAbout = mountModal(overlay, box, close);
  close.addEventListener('click', () => closeAbout());
}
