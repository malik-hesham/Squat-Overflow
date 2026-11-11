// The break screen's exercise demo, as in the extension's break window (extension/lib/demo-panel.js):
// the drawn 3D figure at once, then the move's demo video from the API server in its place once it
// can play; the figure stays when there is no video, no network or no server. SVG and expo-video are
// the native boundaries here: SVG as plain host components (as in DemoModel.test.tsx), and a fake
// player that reports whatever status the test gives it.
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { API_URL } from '../../../../extension/config.js';
import { DemoModel } from '../DemoModel';
import { ExerciseDemo } from '../ExerciseDemo';

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Line: 'Line',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  Polygon: 'Polygon',
}));

type MockListener = (event: { status: string }) => void;
type FakePlayer = {
  source: unknown;
  loop: boolean;
  muted: boolean;
  status: string;
  play: jest.Mock;
  addListener: (event: string, fn: MockListener) => { remove: () => void };
  emit: (status: string) => void;
};
const mockPlayers: FakePlayer[] = [];
jest.mock('expo-video', () => {
  const React = require('react');
  return {
    VideoView: 'VideoView',
    useVideoPlayer: (source: unknown, setup?: (p: FakePlayer) => void) =>
      React.useMemo(() => {
        const listeners = new Set<MockListener>();
        const player: FakePlayer = {
          source,
          loop: false,
          muted: false,
          status: 'loading',
          play: jest.fn(),
          addListener: (_event, fn) => {
            listeners.add(fn);
            return { remove: () => listeners.delete(fn) };
          },
          emit(status) {
            player.status = status;
            listeners.forEach((fn) => fn({ status }));
          },
        };
        setup?.(player);
        mockPlayers.push(player);
        return player;
      }, [source]),
  };
});

const videos = (tree: ReactTestRenderer) => tree.root.findAll((n: ReactTestInstance) => String(n.type) === 'VideoView');
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

describe('ExerciseDemo', () => {
  let tree: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    mockPlayers.length = 0;
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  });

  it("shows the figure while the move's video loads, then the video in its place, muted and looping", () => {
    act(() => {
      tree = create(<ExerciseDemo move={{ key: 'neck_tilt', label: 'Neck side tilt' }} lang="en" />);
    });
    const player = mockPlayers.at(-1)!;
    expect(player.source).toBe(`${API_URL}/demos/neck_tilt.mp4`);
    expect({ loop: player.loop, muted: player.muted }).toEqual({ loop: true, muted: true });
    expect(player.play).toHaveBeenCalled();
    expect(tree!.root.findByType(DemoModel).props.label).toBe('3D demo: Neck side tilt');
    expect(text(tree!)).toContain('Drag to turn the figure');
    expect(videos(tree!)).toHaveLength(0);

    act(() => player.emit('readyToPlay'));
    expect(videos(tree!)[0].props).toMatchObject({
      player,
      nativeControls: false,
      contentFit: 'contain',
      accessibilityLabel: 'Demo video: Neck side tilt',
    });
    expect(tree!.root.findAllByType(DemoModel)).toHaveLength(0);
    expect(text(tree!)).not.toContain('Drag to turn');

    act(() => player.emit('loading')); // a moment of buffering doesn't flash the figure back
    expect(videos(tree!)).toHaveLength(1);
  });

  it('keeps the figure when the move has no video, or the phone is offline', () => {
    act(() => {
      tree = create(<ExerciseDemo move={{ key: 'hip_hinge', label: 'Hip hinge' }} lang="en" />);
    });
    act(() => mockPlayers.at(-1)!.emit('error'));
    expect(videos(tree!)).toHaveLength(0);
    expect(tree!.root.findByType(DemoModel).props.moveKey).toBe('hip_hinge');
  });

  it("asks for the next move's video when the move changes, starting from its figure", () => {
    act(() => {
      tree = create(<ExerciseDemo move={{ key: 'neck_tilt', label: 'Neck side tilt' }} lang="en" />);
    });
    act(() => mockPlayers.at(-1)!.emit('readyToPlay'));
    act(() => tree!.update(<ExerciseDemo move={{ key: 'chin_tuck', label: 'Chin tuck' }} lang="en" />));
    expect(mockPlayers.at(-1)!.source).toBe(`${API_URL}/demos/chin_tuck.mp4`);
    expect(videos(tree!)).toHaveLength(0);
    expect(tree!.root.findByType(DemoModel).props.moveKey).toBe('chin_tuck');
  });

  it('with no server set, asks for nothing and shows the figure', () => {
    jest.isolateModules(() => {
      jest.doMock('../../../../extension/config.js', () => ({ API_URL: '', GOOGLE_CLIENT_ID: '', SYNC_ENABLED: false }));
      const renderer = require('react-test-renderer');
      const R = require('react');
      const { ExerciseDemo: Demo } = require('../ExerciseDemo');
      let local: ReactTestRenderer | undefined;
      renderer.act(() => {
        local = renderer.create(R.createElement(Demo, { move: { key: 'neck_tilt', label: 'Neck side tilt' }, lang: 'en' }));
      });
      expect(mockPlayers).toHaveLength(0);
      expect(JSON.stringify(local!.toJSON())).toContain('Drag to turn the figure');
      renderer.act(() => local!.unmount());
    });
  });
});
