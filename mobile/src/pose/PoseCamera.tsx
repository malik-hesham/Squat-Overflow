// The coached camera: front camera frames go through MediaPipe on-device
// (modules/squat-pose), the landmarks through the same rep counting and form
// scoring as the extension (extension/lib/pose via src/pose/analysis), and each
// result reaches the break screen as one FrameResult, like the extension's frames.
import { BlurTargetView, BlurView } from 'expo-blur';
import * as React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  Camera,
  useCamera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type CameraDevice,
  type CameraOutput,
} from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import { createPoseDetector, type PoseResult } from 'react-native-squat-pose';

import { alignWorldY, Session } from './analysis';
import { cameraLook } from './privacy';
import { startSimulatedCoach } from './simulate';
import { Skeleton } from './Skeleton';
import type { CoachStatus, FrameResult, Landmark } from './types';

const FRAME_SIZE = { width: 640, height: 480 };
const BLUR_INTENSITY = 100; // as strong as the extension's (24x downscale): shape and motion show, faces don't
const STALL_MS = 8000; // no result for this long after starting: treat the coach as offline

type Props = {
  exercise: string;
  active: boolean;
  privacy: boolean; // blur the camera picture (see ./privacy)
  onFrame: (msg: FrameResult) => void;
  onStatus: (status: CoachStatus | 'simulated') => void;
};

function toTriples(flat: number[], n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + n <= flat.length; i += n) out.push(flat.slice(i, i + n));
  return out;
}

export function PoseCamera(props: Props) {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission, canRequestPermission } = useCameraPermission();
  const [asked, setAsked] = React.useState(false);

  React.useEffect(() => {
    if (hasPermission || asked || !device) return;
    setAsked(true);
    if (canRequestPermission) void requestPermission();
  }, [hasPermission, asked, canRequestPermission, requestPermission, device]);

  React.useEffect(() => {
    if (device) {
      if (asked && !hasPermission && !canRequestPermission) props.onStatus('camera-denied');
      return;
    }
    // No front camera: a simulator in development, or a device without one.
    if (!__DEV__) props.onStatus('camera-denied');
  }, [device, asked, hasPermission, canRequestPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!device) return __DEV__ ? <SimulatedCoach {...props} /> : <Backdrop />;
  if (!hasPermission) return <Backdrop />;
  return <LiveCoach device={device} {...props} />;
}

function Backdrop({ children }: { children?: React.ReactNode }) {
  return <View style={[StyleSheet.absoluteFill, styles.backdrop]}>{children}</View>;
}

function SimulatedCoach({ exercise, active, onFrame, onStatus }: Props) {
  const current = React.useRef(exercise);
  current.current = exercise;
  React.useEffect(() => {
    if (!active) return;
    onStatus('simulated');
    return startSimulatedCoach(() => current.current, onFrame);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Backdrop />;
}

function LiveCoach({ device, exercise, active, privacy, onFrame, onStatus }: Props & { device: CameraDevice }) {
  const detector = React.useMemo(() => createPoseDetector(), []);
  const session = React.useRef<Session | null>(null);
  const [pose, setPose] = React.useState<{ landmarks: Landmark[] | null; frame: { width: number; height: number } | null; issues: boolean }>({
    landmarks: null,
    frame: null,
    issues: false,
  });
  const lastResultAt = React.useRef(0);
  const started = React.useRef(0);
  const callbacks = React.useRef({ onFrame, onStatus });
  callbacks.current = { onFrame, onStatus };

  if (!session.current) session.current = new Session(exercise);

  React.useEffect(() => {
    session.current?.setExercise(exercise);
    setPose((p) => ({ ...p, landmarks: null }));
  }, [exercise]);

  React.useEffect(() => () => detector.close(), [detector]);

  const handle = React.useCallback((result: PoseResult | null) => {
    const s = session.current;
    if (!s) return;
    const first = lastResultAt.current === 0;
    lastResultAt.current = Date.now();
    if (first) callbacks.current.onStatus('open');
    const t = performance.now() / 1000;
    let landmarks: Landmark[] | null = null;
    let out;
    if (result) {
      landmarks = toTriples(result.landmarks, 3) as Landmark[];
      const world = result.world.length ? alignWorldY(landmarks, toTriples(result.world, 3) as [number, number, number][]) : null;
      out = s.process(landmarks, result.width, result.height, t, world);
    } else {
      out = s.process(null, FRAME_SIZE.width, FRAME_SIZE.height, t, null);
    }
    const msg: FrameResult = { ...out, landmarks };
    setPose({
      landmarks,
      frame: result ? { width: result.width, height: result.height } : null,
      issues: msg.feedback.length > 0,
    });
    callbacks.current.onFrame(msg);
  }, []);

  const fail = React.useCallback((message: string) => {
    console.warn('Pose detection failed:', message);
    callbacks.current.onStatus('offline');
  }, []);

  // Detection runs right on the frame output's thread, as in Vision Camera's
  // plugin docs; `dropFramesWhileBusy` lowers the frame rate instead of queueing
  // when the model is slower than the camera. (A nested AsyncRunner worklet
  // can't call back into React: the callbacks arrive there as plain objects.)
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: FRAME_SIZE,
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      let result: PoseResult | null = null;
      let error: string | null = null;
      try {
        result = detector.detect(frame) ?? null;
      } catch (e) {
        error = `${(e as { message?: string })?.message ?? e}`;
      } finally {
        frame.dispose();
      }
      if (error !== null) scheduleOnRN(fail, error);
      else scheduleOnRN(handle, result);
    },
  });

  // A model that never answers (or a camera that never starts) falls back to
  // the instructions, like the extension when its pose model can't start.
  React.useEffect(() => {
    if (!active) return;
    started.current = Date.now();
    lastResultAt.current = 0;
    callbacks.current.onStatus('starting');
    const id = setInterval(() => {
      if (!lastResultAt.current && Date.now() - started.current > STALL_MS) fail('no pose results');
    }, 1000);
    return () => clearInterval(id);
  }, [active, fail]);

  const outputs: CameraOutput[] = [frameOutput];
  const look = cameraLook({ privacy, os: Platform.OS, version: Platform.Version });
  const blurTarget = React.useRef<View>(null);
  return (
    <View style={StyleSheet.absoluteFill}>
      {look === 'hidden' ? (
        <>
          <HeadlessCamera device={device} active={active} outputs={outputs} onError={fail} />
          <Backdrop />
        </>
      ) : (
        // The camera stays mounted when privacy toggles, so it doesn't restart.
        <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
          {/* Frames stay unmirrored for the analysis; only the picture is flipped into a selfie view. */}
          <Camera
            style={[StyleSheet.absoluteFill, styles.mirror]}
            device={device}
            isActive={active}
            outputs={outputs}
            mirrorMode="off"
            resizeMode="cover"
            // Android can only blur a TextureView preview (the default SurfaceView isn't captured).
            implementationMode="compatible"
            onError={(e) => fail(e.message)}
          />
        </BlurTargetView>
      )}
      {look === 'blur' ? (
        <BlurView
          style={StyleSheet.absoluteFill}
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={BLUR_INTENSITY}
          tint="dark"
        />
      ) : null}
      <Skeleton landmarks={pose.landmarks} frame={pose.frame} issues={pose.issues} />
    </View>
  );
}

// Privacy mode where no real blur exists (older Android): the camera runs
// without a preview, so no camera pixels are ever drawn; only the skeleton shows.
function HeadlessCamera({ device, active, outputs, onError }: { device: CameraDevice; active: boolean; outputs: CameraOutput[]; onError: (m: string) => void }) {
  useCamera({ device, isActive: active, outputs, mirrorMode: 'off', onError: (e) => onError(e.message) });
  return null;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#11161a' },
  mirror: { transform: [{ scaleX: -1 }] },
});
