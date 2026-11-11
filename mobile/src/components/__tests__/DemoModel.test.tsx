// The 3D exercise demo on the break screen: the extension's figure
// (extension/lib/demo-model.js), drawn with react-native-svg. SVG is the native
// boundary here, mocked as plain host components so the test can read what was drawn.
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { demoScene, demoTurn, demoView } from '@/src/core/shared';
import { DemoModel, FRAME_MS } from '../DemoModel';

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Line: 'Line',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  Polygon: 'Polygon',
}));

// Node's fs, as in src/pose/analysis/__tests__/helpers.ts (the app's types have no Node).
declare const require: (id: 'fs') => { readFileSync(file: string, encoding: 'utf8'): string };
declare const __dirname: string;

const SIZE = { width: 320, height: 240 };

/** What the shared scene says to paint, in the props SVG takes. */
function expected(key: string, t: number, turn = 0) {
  return demoScene(key, t, demoView(key, t, { ...SIZE, turn })!)!.map((sh) =>
    sh.kind === 'poly'
      ? ['Polygon', { points: sh.points.join(' '), fill: sh.fill }]
      : sh.kind === 'capsule'
      ? ['Line', { x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, stroke: sh.fill, strokeWidth: sh.r * 2, strokeLinecap: 'round' }]
      : sh.kind === 'circle'
        ? ['Circle', { cx: sh.x, cy: sh.y, r: sh.r, fill: sh.fill }]
        : ['Ellipse', { cx: sh.x, cy: sh.y, rx: sh.rx, ry: sh.ry, fill: sh.fill }],
  );
}

function drawn(tree: ReactTestRenderer) {
  return tree.root
    .findAll((n) => typeof n.type === 'string' && ['Line', 'Circle', 'Ellipse', 'Polygon'].includes(n.type))
    .map((n) => {
      const { points, x1, y1, x2, y2, stroke, strokeWidth, strokeLinecap, cx, cy, r, rx, ry, fill } = n.props;
      const all = { points, x1, y1, x2, y2, stroke, strokeWidth, strokeLinecap, cx, cy, r, rx, ry, fill };
      return [n.type, Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined))];
    });
}

/** The view that reports its size (the demo draws once it knows it). */
function layout(tree: ReactTestRenderer) {
  const [box] = tree.root.findAll((n: ReactTestInstance) => typeof n.type === 'string' && typeof n.props.onLayout === 'function');
  act(() => box.props.onLayout({ nativeEvent: { layout: SIZE } }));
  return box;
}

describe('DemoModel', () => {
  let tree: ReactTestRenderer | undefined;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  });

  it("draws the extension's 3D figure for the move, shape for shape", () => {
    act(() => {
      tree = create(<DemoModel moveKey="neck_tilt" label="3D demo: Neck side tilt" />);
    });
    layout(tree!);
    expect(drawn(tree!)).toEqual(expected('neck_tilt', 0));
    // The person is filled outlines (the extension's flat, illustrated look), not sticks.
    expect(drawn(tree!).filter(([type]) => String(type) === 'Polygon').length).toBeGreaterThan(20);
  });

  it('moves with time, and starts over from the rest pose for the next move', () => {
    act(() => {
      tree = create(<DemoModel moveKey="t_raise" label="3D demo: T-raise" />);
    });
    layout(tree!);
    const frames = 45; // about 1.5 s
    act(() => jest.advanceTimersByTime(frames * FRAME_MS));
    const later = drawn(tree!);
    expect(later).not.toEqual(expected('t_raise', 0));
    expect(later).toEqual(expected('t_raise', (frames * FRAME_MS) / 1000));
    act(() => tree!.update(<DemoModel moveKey="hip_hinge" label="3D demo: Hip hinge" />));
    expect(drawn(tree!)).toEqual(expected('hip_hinge', 0));
  });

  // The drag rule is shared (extension/tests/check.mjs pins its direction): the phone turns the
  // figure exactly as far, and the same way, as the extension for the same drag.
  it('turns the figure by the shared drag rule', () => {
    act(() => {
      tree = create(<DemoModel moveKey="t_raise" label="3D demo: T-raise" />);
    });
    const box = layout(tree!);
    const touch = (x: number, ts: number, prev: number) => ({
      touchHistory: {
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: ts,
        touchBank: [
          { touchActive: true, startPageX: 100, startPageY: 50, startTimeStamp: 0, currentPageX: x, currentPageY: 50, currentTimeStamp: ts, previousPageX: prev, previousPageY: 50, previousTimeStamp: ts - 16 },
        ],
      },
      nativeEvent: { touches: [{}], changedTouches: [{}] },
    });
    act(() => {
      box.props.onResponderGrant(touch(100, 16, 100));
      box.props.onResponderMove(touch(160, 32, 100));
    });
    expect(drawn(tree!)).toEqual(expected('t_raise', 0, demoTurn(60)));
    expect(drawn(tree!)).not.toEqual(expected('t_raise', 0));
  });

  it('is an image with a label for screen readers', () => {
    act(() => {
      tree = create(<DemoModel moveKey="chin_tuck" label="3D demo: Chin tuck" />);
    });
    const box = layout(tree!);
    expect(box.props.accessibilityRole).toBe('image');
    expect(box.props.accessibilityLabel).toBe('3D demo: Chin tuck');
  });

  it('the break screen shows it instead of a YouTube player', () => {
    const screen = require('fs').readFileSync(`${__dirname}/../../../app/break.tsx`, 'utf8');
    expect(screen).toMatch(/<DemoModel\b/);
    expect(screen).not.toMatch(/youtube|DemoVideo|WebView/i);
  });
});
