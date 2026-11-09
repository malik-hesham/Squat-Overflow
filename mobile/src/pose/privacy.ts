// How the coached camera shows the user, like the extension's privacy "Look":
// privacy off shows the clear camera, privacy on blurs it. expo-blur can only
// blur a native view on iOS and on Android 12+ (SDK 31); older Android falls
// back to a see-through tint, which would show clear pixels, so the picture is
// hidden there instead (only the skeleton shows).
export type CameraLook = 'clear' | 'blur' | 'hidden';

const ANDROID_BLUR_MIN_SDK = 31;

export function cameraLook({
  privacy,
  os,
  version,
}: {
  privacy: boolean;
  os: string;
  version: number | string;
}): CameraLook {
  if (!privacy) return 'clear';
  if (os === 'android') return Number(version) >= ANDROID_BLUR_MIN_SDK ? 'blur' : 'hidden';
  return 'blur';
}
