// What the coached camera box shows. The native boundaries (Vision Camera, the
// MediaPipe module, worklets, expo-blur, SVG) are replaced by plain host views
// so the test sees which ones PoseCamera mounts.
import * as React from 'react';
import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PoseCamera } from '../PoseCamera';

const mockUseCamera = jest.fn();

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCamera: (...args: unknown[]) => mockUseCamera(...args),
  useCameraDevice: () => ({ id: 'front' }),
  useCameraPermission: () => ({
    hasPermission: true,
    canRequestPermission: false,
    requestPermission: jest.fn(),
  }),
  useFrameOutput: () => ({ kind: 'frame-output' }),
}));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: jest.fn() }));
jest.mock('react-native-squat-pose', () => ({
  createPoseDetector: () => ({ detect: () => null, close: () => {} }),
}));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView', BlurTargetView: 'BlurTargetView' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Line: 'Line',
  Circle: 'Circle',
}));

function renderCamera(privacy: boolean): ReactTestRenderer {
  let out!: ReactTestRenderer;
  act(() => {
    out = create(
      <PoseCamera
        exercise="squat"
        active
        privacy={privacy}
        onFrame={() => {}}
        onStatus={() => {}}
      />
    );
  });
  return out;
}

const count = (t: ReactTestRenderer, type: string) => t.root.findAll((n) => n.type === type).length;

function onPlatform(os: 'ios' | 'android', version: number) {
  jest.replaceProperty(Platform, 'OS', os);
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
}

describe('PoseCamera', () => {
  let tree: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers(); // the stall watchdog runs on an interval
    mockUseCamera.mockClear();
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the camera picture under a blur in privacy mode', () => {
    onPlatform('ios', 27);
    tree = renderCamera(true);
    expect(count(tree, 'Camera')).toBe(1);
    expect(count(tree, 'BlurView')).toBe(1);
    expect(count(tree, 'Svg')).toBe(1); // the skeleton stays on top
  });

  it('shows the clear camera picture with no blur when privacy is off', () => {
    onPlatform('ios', 27);
    tree = renderCamera(false);
    expect(count(tree, 'Camera')).toBe(1);
    expect(count(tree, 'BlurView')).toBe(0);
  });

  it('runs the camera without a picture in privacy mode on Android without a real blur', () => {
    onPlatform('android', 30);
    tree = renderCamera(true);
    expect(count(tree, 'Camera')).toBe(0);
    expect(count(tree, 'BlurView')).toBe(0);
    expect(mockUseCamera).toHaveBeenCalled(); // frames still reach the coach
  });
});
