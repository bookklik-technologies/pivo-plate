export function isEmbeddedMode(search: string): boolean {
  const setting = new URLSearchParams(search).get('embed')?.toLowerCase();
  return setting === '1' || setting === 'true' || setting === 'on';
}

export function isRecoveryEnabled(search: string): boolean {
  if (isEmbeddedMode(search)) return false;
  const setting = new URLSearchParams(search).get('recovery')?.toLowerCase();
  return setting !== 'off' && setting !== 'false' && setting !== '0';
}

export const recoveryEnabled = isRecoveryEnabled(typeof location === 'undefined' ? '' : location.search);
export const embeddedMode = isEmbeddedMode(typeof location === 'undefined' ? '' : location.search);

export function assertRecoveryUpdateSafe(hasUnsavedChanges: boolean, enabled = recoveryEnabled): void {
  if (!enabled && hasUnsavedChanges) throw new Error('Browser recovery is disabled. Save all project downloads before updating.');
}
