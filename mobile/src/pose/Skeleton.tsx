import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import type { Landmark } from './types';

const MIN_VIS = 0.5;
// MediaPipe's body connections (no face), as in extension/lib/pose-client.js.
const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25],
  [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// Draws the pose over a view showing the frame scaled to cover it, mirrored
// like a selfie (landmarks are for the unmirrored camera image).
export function Skeleton({
  landmarks,
  frame,
  issues,
}: {
  landmarks: Landmark[] | null;
  frame: { width: number; height: number } | null;
  issues: boolean;
}) {
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const color = issues ? '#ffb547' : '#3ddc97';
  let lines: React.ReactNode[] = [];
  let dots: React.ReactNode[] = [];
  if (landmarks && frame && box.width && box.height) {
    // resizeMode "cover": scale to fill, crop the overflow evenly.
    const scale = Math.max(box.width / frame.width, box.height / frame.height);
    const dx = (box.width - frame.width * scale) / 2;
    const dy = (box.height - frame.height * scale) / 2;
    const px = (lm: Landmark) => [(1 - lm[0]) * frame.width * scale + dx, lm[1] * frame.height * scale + dy];
    const w = Math.max(3, box.width / 120);
    lines = CONNECTIONS.filter(([a, b]) => landmarks[a]?.[2] >= MIN_VIS && landmarks[b]?.[2] >= MIN_VIS).map(([a, b]) => {
      const [x1, y1] = px(landmarks[a]);
      const [x2, y2] = px(landmarks[b]);
      return <Line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />;
    });
    dots = landmarks.slice(11).flatMap((lm, k) => {
      if (lm[2] < MIN_VIS) return [];
      const [x, y] = px(lm);
      return [<Circle key={k} cx={x} cy={y} r={w * 1.3} fill="#ffffff" stroke={color} strokeWidth={2} />];
    });
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <Svg width={box.width} height={box.height}>
        {lines}
        {dots}
      </Svg>
    </View>
  );
}
