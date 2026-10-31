import { describe, expect, it } from 'vitest';
import { assertRecoveryUpdateSafe, isEmbeddedMode, isRecoveryEnabled } from '../src/ui/recovery-policy';

describe('browser recovery policy', () => {
  it.each(['?embed=1', '?embed=true', '?embed=on', '?embed=ON', '?embed=1&recovery=on'])('disables recovery in headerless embed mode: %s', search => {
    expect(isEmbeddedMode(search)).toBe(true);
    expect(isRecoveryEnabled(search)).toBe(false);
  });

  it.each(['', '?embed=0', '?embed=false', '?embed=unknown', '?recovery=off'])('does not hide the header without an explicit embed flag: %s', search => {
    expect(isEmbeddedMode(search)).toBe(false);
  });

  it.each(['', '?recovery=on', '?recovery=true', '?recovery=1', '?recovery=unknown', '?theme=dark'])('keeps recovery enabled by default: %s', search => {
    expect(isRecoveryEnabled(search)).toBe(true);
  });

  it.each(['?recovery=off', '?recovery=false', '?recovery=0', '?recovery=OFF', '?theme=dark&recovery=off'])('supports explicit session opt-out: %s', search => {
    expect(isRecoveryEnabled(search)).toBe(false);
  });

  it('blocks updates that would lose unsaved work when recovery is disabled', () => {
    expect(() => assertRecoveryUpdateSafe(true, false)).toThrow(/Save all project downloads/);
    expect(() => assertRecoveryUpdateSafe(false, false)).not.toThrow();
    expect(() => assertRecoveryUpdateSafe(true, true)).not.toThrow();
  });
});
