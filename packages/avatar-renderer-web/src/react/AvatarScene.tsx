// AvatarScene: the R3F canvas for the avatar, with the same light rig and framing as the vanilla view.
import { Canvas, useThree } from '@react-three/fiber';
import { createContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FIELD_OF_VIEW, type Framing } from '../camera.ts';
import { createLighting } from '../lighting.ts';

/** The framing HumanAvatar points the camera with. */
export const FramingContext = createContext<Framing>('portrait');

export interface AvatarSceneProps {
  readonly framing?: Framing;
  /** Caps the device pixel ratio; lower it on phones and low-end machines. Default 2. */
  readonly maxPixelRatio?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

export function AvatarScene({
  framing = 'portrait',
  maxPixelRatio = 2,
  className,
  style,
  children,
}: AvatarSceneProps) {
  const hidden = usePageHidden();
  return (
    <Canvas
      // A hidden page (tab in the background, side panel closed) draws nothing.
      frameloop={hidden ? 'never' : 'always'}
      dpr={[1, maxPixelRatio]}
      camera={{ fov: FIELD_OF_VIEW[framing], near: 0.05, far: 50 }}
      gl={{ antialias: true, alpha: true }}
      {...(className === undefined ? {} : { className })}
      {...(style === undefined ? {} : { style })}>
      <Lighting />
      <FramingContext.Provider value={framing}>{children}</FramingContext.Provider>
    </Canvas>
  );
}

function Lighting() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const lighting = createLighting(gl, scene);
    return () => {
      lighting.dispose();
    };
  }, [gl, scene]);
  return null;
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => {
      setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);
  return hidden;
}
