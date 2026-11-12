// The break screen's exercise demo, as in the extension's break window (extension/lib/demo-panel.js):
// the drawn 3D figure at once, then the move's demo video from the API server in its place once it
// can play, credited when the footage isn't ours; the figure stays when there is no video (nothing
// is asked for), no network or no server. SVG and expo-video are
// the native boundaries here: SVG as plain host components (as in DemoModel.test.tsx), and a fake
// player that reports whatever status the test gives it.
import * as React from 'react';
import { Linking } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { API_URL } from '../../../../extension/config.js';
import { DEMO_VIDEOS } from '../../../../extension/lib/demo-video.js';
import { exerciseCatalog } from '../../../../extension/lib/pose/index.js';
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
const links = (tree: ReactTestRenderer) =>
  tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityRole === 'link' && typeof n.props.onPress === 'function');
const SQUAT = { key: 'mini_squat', label: 'Mini squat' };
const CREDIT = 'Clip from “Mini Squats” by Motion, CC BY 3.0';
/** A move with no demo video yet: the first in the catalog that DEMO_VIDEOS doesn't list (more get one over time). */
const NO_VIDEO = exerciseCatalog().find((e: { key: string }) => !Object.prototype.hasOwnProperty.call(DEMO_VIDEOS, e.key))!;

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
      tree = create(<ExerciseDemo move={SQUAT} lang="en" />);
    });
    const player = mockPlayers.at(-1)!;
    expect(player.source).toBe(`${API_URL}/demos/mini_squat.mp4`);
    expect({ loop: player.loop, muted: player.muted }).toEqual({ loop: true, muted: true });
    expect(player.play).toHaveBeenCalled();
    expect(tree!.root.findByType(DemoModel).props.label).toBe('3D demo: Mini squat');
    expect(text(tree!)).toContain('Drag to turn the figure');
    expect(videos(tree!)).toHaveLength(0);
    expect(text(tree!)).not.toContain('Clip from');

    act(() => player.emit('readyToPlay'));
    expect(videos(tree!)[0].props).toMatchObject({
      player,
      nativeControls: false,
      contentFit: 'contain',
      accessibilityLabel: 'Demo video: Mini squat',
    });
    expect(tree!.root.findAllByType(DemoModel)).toHaveLength(0);
    expect(text(tree!)).not.toContain('Drag to turn');

    act(() => player.emit('loading')); // a moment of buffering doesn't flash the figure back
    expect(videos(tree!)).toHaveLength(1);
  });

  it('credits the footage under the video, as the extension does, and opens the original when tapped', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    act(() => {
      tree = create(<ExerciseDemo move={SQUAT} lang="en" />);
    });
    act(() => mockPlayers.at(-1)!.emit('readyToPlay'));
    expect(text(tree!)).toContain(CREDIT);
    const [link] = links(tree!);
    act(() => {
      link.props.onPress(); // a block body: act given a promise turns async and holds later renders
    });
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=wqCvuhfRXRU');
    open.mockRestore();
  });

  it('keeps the figure and asks for nothing when the move has no video', () => {
    act(() => {
      tree = create(<ExerciseDemo move={{ key: NO_VIDEO.key, label: NO_VIDEO.label }} lang="en" />);
    });
    expect(mockPlayers).toHaveLength(0);
    expect(tree!.root.findByType(DemoModel).props.moveKey).toBe(NO_VIDEO.key);
    expect(text(tree!)).not.toContain('Clip from');
  });

  it('keeps the figure when the phone is offline', () => {
    act(() => {
      tree = create(<ExerciseDemo move={SQUAT} lang="en" />);
    });
    act(() => mockPlayers.at(-1)!.emit('error'));
    expect(videos(tree!)).toHaveLength(0);
    expect(tree!.root.findByType(DemoModel).props.moveKey).toBe('mini_squat');
    expect(text(tree!)).not.toContain('Clip from');
  });

  it("asks for the next move's video when the move changes, starting from its figure", () => {
    act(() => {
      tree = create(<ExerciseDemo move={SQUAT} lang="en" />);
    });
    act(() => mockPlayers.at(-1)!.emit('readyToPlay'));
    act(() => tree!.update(<ExerciseDemo move={{ key: 'hip_hinge', label: 'Hip hinge' }} lang="en" />));
    expect(mockPlayers.at(-1)!.source).toBe(`${API_URL}/demos/hip_hinge.mp4`);
    expect(videos(tree!)).toHaveLength(0);
    expect(tree!.root.findByType(DemoModel).props.moveKey).toBe('hip_hinge');
  });

  it('shows no credit under footage of our own', () => {
    jest.isolateModules(() => {
      jest.doMock('react', () => React); // one React for the renderer, the component and the expo-video mock
      jest.doMock('../../../../extension/lib/demo-video.js', () => ({
        DEMO_VIDEOS: { neck_tilt: null },
        demoVideoUrl: (api: string, key: string) => (api && key === 'neck_tilt' ? `${api}/demos/neck_tilt.mp4` : null),
        demoCredit: () => null,
      }));
      const renderer = require('react-test-renderer');
      const R = require('react');
      const { ExerciseDemo: Demo } = require('../ExerciseDemo');
      let local: ReactTestRenderer | undefined;
      renderer.act(() => {
        local = renderer.create(R.createElement(Demo, { move: { key: 'neck_tilt', label: 'Neck side tilt' }, lang: 'en' }));
      });
      renderer.act(() => mockPlayers.at(-1)!.emit('readyToPlay'));
      expect(videos(local!)).toHaveLength(1);
      expect(links(local!)).toHaveLength(0);
      renderer.act(() => local!.unmount());
    });
  });

  it('with no server set, asks for nothing and shows the figure', () => {
    jest.isolateModules(() => {
      jest.doMock('../../../../extension/config.js', () => ({ API_URL: '', GOOGLE_CLIENT_ID: '', SYNC_ENABLED: false }));
      const renderer = require('react-test-renderer');
      const R = require('react');
      const { ExerciseDemo: Demo } = require('../ExerciseDemo');
      let local: ReactTestRenderer | undefined;
      renderer.act(() => {
        local = renderer.create(R.createElement(Demo, { move: SQUAT, lang: 'en' }));
      });
      expect(mockPlayers).toHaveLength(0);
      expect(JSON.stringify(local!.toJSON())).toContain('Drag to turn the figure');
      renderer.act(() => local!.unmount());
    });
  });
});
