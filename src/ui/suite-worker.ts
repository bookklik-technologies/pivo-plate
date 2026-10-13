const scripts=new Map<string,Promise<string>>();
/** Retain file code before an update replaces its cached assets in other tabs. */
export function prepareWorker(source: string): Promise<string> {
  let script=scripts.get(source);
  if(!script){script=fetch(source,{signal:AbortSignal.timeout(15000)}).then(response=>{if(!response.ok)throw new Error('File worker could not be loaded. Reload online before working offline.');return response.text();}).catch(error=>{scripts.delete(source);throw error;});scripts.set(source,script);}
  return script;
}
/** One operation per worker: cancellation and failure cannot mutate the live document. */
export async function runWorker<T>(source: string, request: unknown, label?: string): Promise<T> {
  // Standalone builds embed the worker as data. Own the Blob URL until termination;
  // revoking it during worker startup can cause WebKit access-control failures.
  // Fetch through the controlled page so offline caching also works in WebKit,
  // whose worker-entry requests do not consistently pass through its controller.
  // Vite development workers retain imports and need their original module URL.
  // Bundled workers are self-contained classic scripts, including standalone HTML.
  const embedded=import.meta.env.DEV ? null : URL.createObjectURL(new Blob([await prepareWorker(source)],{type:'text/javascript'}));
  let worker:Worker;
  try { worker = import.meta.env.DEV ? new Worker(source,{type:'module'}) : new Worker(embedded!); }
  catch(error) { if(embedded)URL.revokeObjectURL(embedded);throw error; }
  const panel = label ? document.createElement('div') : null;
  if (panel) { panel.className = 'suite-update'; panel.setAttribute('role', 'status'); panel.textContent = `${label}… `; document.body.append(panel); }
  document.documentElement.dataset.archiveBusy = String(Number(document.documentElement.dataset.archiveBusy ?? 0) + 1);
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('File operation exceeded its time budget. Reduce document size.')), 120000);
      const finish = (run: () => void) => { clearTimeout(timer); run(); };
      worker.onmessage = event => finish(() => event.data.ok ? resolve(event.data.value as T) : reject(new Error(event.data.error)));
      worker.onerror = event => { event.preventDefault();finish(() => reject(new Error(event.message || 'File worker failed'))); };
      worker.onmessageerror = () => finish(() => reject(new Error('File worker returned invalid data')));
      if (panel) {
        const cancel = document.createElement('button'); cancel.textContent = 'Cancel file operation';
        cancel.onclick = () => finish(() => reject(new Error('File operation cancelled; your current document is kept')));
        panel.append(cancel);
      }
      try { worker.postMessage(request); } catch (error) { finish(() => reject(error)); }
    });
  } finally {
    worker.terminate();if(embedded)URL.revokeObjectURL(embedded);panel?.remove();
    document.documentElement.dataset.archiveBusy = String(Math.max(0, Number(document.documentElement.dataset.archiveBusy) - 1));
  }
}
