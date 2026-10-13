import { registerSW } from 'virtual:pwa-register';

/** Each tab authorizes its own reload after storing its current artwork. */
export function installUpdatePrompt(options: { ready: () => boolean; flush: () => Promise<void>; notify: (message: string) => void }): void {
  let reloadReady = false;
  let reloadAllowed = false;
  let applying = false;

  function showPrompt(): void {
    if (document.getElementById('pivo-update')) return;
    const panel = document.createElement('div');
    panel.id = 'pivo-update'; panel.className = 'suite-update'; panel.setAttribute('role', 'status');
    panel.append('An editor update is ready. ');
    const later = document.createElement('button'); later.textContent = 'Later';
    const apply = document.createElement('button'); apply.textContent = 'Save recovery and update';
    later.onclick = () => { if (!applying) panel.remove(); };
    apply.onclick = async () => {
      if (applying) return;
      if (!options.ready()) { options.notify('Finish the current gesture, dialog or export before updating.'); return; }
      applying = true; apply.disabled = later.disabled = true;
      // Inert app surfaces and capture keyboard shortcuts until recovery/reload
      // finishes. Otherwise edits during an asynchronous flush could be lost.
      const elements = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== panel);
      const previous = elements.map(el => el.inert);
      elements.forEach(el => { el.inert = true; });
      const blockKeys = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
      document.addEventListener('keydown', blockKeys, true);
      let released = false;
      const unlock = () => {
        if (released) return; released = true;
        elements.forEach((el, index) => { el.inert = previous[index]; });
        document.removeEventListener('keydown', blockKeys, true);
        applying = false; apply.disabled = later.disabled = false;
      };
      try {
        await options.flush();
        if (!options.ready()) throw new Error('The editor became busy. Finish the current operation before updating.');
        if (!confirm('Recovery has been stored. Reload to update? Keep a downloaded project backup of valuable work.')) return;
        reloadAllowed = true;
        if (reloadReady) window.location.reload();
        else await update(true);
        // Hold the lock through worker activation. Restore usability if it stalls.
        setTimeout(() => {
          reloadAllowed = false; unlock();
          options.notify('Update reload did not finish. Your artwork is kept. Try the update again or download a project backup.');
        }, 15000);
      } catch (error) {
        reloadAllowed = false;
        options.notify(`Update deferred: ${error instanceof Error ? error.message : String(error)}. Download a project backup before reloading.`);
      } finally { if (!reloadAllowed) unlock(); }
    };
    panel.append(apply, later); document.body.append(panel);
  }

  const update = registerSW({
    onNeedRefresh: showPrompt,
    onNeedReload() {
      reloadReady = true;
      if (reloadAllowed) window.location.reload();
      else showPrompt(); // A different tab activated the worker; keep this tab's work.
    },
    onRegisterError(error) { options.notify(`Offline installation unavailable: ${String(error)}`); },
  });
}
