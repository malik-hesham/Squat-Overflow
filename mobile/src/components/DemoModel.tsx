// The exercise demo on the break screen: the extension's 3D figure
// (extension/lib/demo-model.js), drawn with SVG. It is made on the phone, so it
// works offline and sends nothing anywhere. Drag to turn it, as in the extension.
import * as React from 'react';
import { AccessibilityInfo, PanResponder, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Polygon } from 'react-native-svg';

import { demoScene, demoTurn, demoView } from '@/src/core/shared';

/** One drawing every 33 ms: plenty for a slow move, and it spares the JS thread. */
export const FRAME_MS = 33;

export function DemoModel({ moveKey, label }: { moveKey: string; label: string }) {
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [t, setT] = React.useState(0);
  const [turn, setTurn] = React.useState(0);
  const [still, setStill] = React.useState(false);
  const turnRef = React.useRef(0);
  turnRef.current = turn;

  // Reduce Motion keeps the camera still (the move itself still plays: it is the demo).
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => live && setStill(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);

  // Each move starts from its rest pose.
  React.useEffect(() => {
    const start = Date.now();
    setT(0);
    const id = setInterval(() => setT((Date.now() - start) / 1000), FRAME_MS);
    return () => clearInterval(id);
  }, [moveKey]);

  const pan = React.useMemo(() => {
    let from = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        from = turnRef.current;
      },
      onPanResponderMove: (_, g) => setTurn(from + demoTurn(g.dx)),
    });
  }, []);

  const view = box.width && box.height ? demoView(moveKey, t, { ...box, turn, still }) : null;
  const shapes = (view && demoScene(moveKey, t, view)) || [];
  return (
    <View
      className="bg-card border-border aspect-[4/3] overflow-hidden rounded-xl border"
      onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      {...pan.panHandlers}>
      {view ? (
        <Svg width={box.width} height={box.height}>
          {shapes.map((sh, i) =>
            sh.kind === 'poly' ? (
              <Polygon key={i} points={sh.points.join(' ')} fill={sh.fill} />
            ) : sh.kind === 'capsule' ? (
              <Line key={i} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} stroke={sh.fill} strokeWidth={sh.r * 2} strokeLinecap="round" />
            ) : sh.kind === 'circle' ? (
              <Circle key={i} cx={sh.x} cy={sh.y} r={sh.r} fill={sh.fill} />
            ) : (
              <Ellipse key={i} cx={sh.x} cy={sh.y} rx={sh.rx} ry={sh.ry} fill={sh.fill} />
            ),
          )}
        </Svg>
      ) : null}
    </View>
  );
}
