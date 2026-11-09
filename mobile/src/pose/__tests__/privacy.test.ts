import { cameraLook } from '../privacy';

describe('cameraLook', () => {
  it('shows the clear camera when privacy is off', () => {
    expect(cameraLook({ privacy: false, os: 'ios', version: 27 })).toBe('clear');
  });

  it('blurs the camera when privacy is on (iOS)', () => {
    expect(cameraLook({ privacy: true, os: 'ios', version: 27 })).toBe('blur');
  });

  it('blurs the camera on Android 12+ (SDK 31), where a real blur is available', () => {
    expect(cameraLook({ privacy: true, os: 'android', version: 31 })).toBe('blur');
  });

  it('hides the camera on older Android, whose blur fallback would show clear pixels', () => {
    expect(cameraLook({ privacy: true, os: 'android', version: 30 })).toBe('hidden');
  });
});
