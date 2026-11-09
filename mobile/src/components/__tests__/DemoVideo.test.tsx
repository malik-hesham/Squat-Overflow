// The demo player on the break screen. WKWebView is the native boundary: the
// mock records how many WebViews were mounted and what each one loaded.
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DemoVideo } from '../DemoVideo';

const mockMounts: string[] = [];

jest.mock('react-native-webview', () => {
  const { useEffect } = require('react');
  function WebView(props: { source: { html: string } }) {
    useEffect(() => {
      mockMounts.push(props.source.html);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  return { WebView };
});

const embedOf = (html: string) => html.match(/youtube-nocookie\.com\/embed\/([\w-]{11})/)?.[1];

describe('DemoVideo', () => {
  let tree: ReactTestRenderer | undefined;

  beforeEach(() => {
    mockMounts.length = 0;
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
  });

  it('plays the given clip from YouTube’s privacy-enhanced player', () => {
    act(() => {
      tree = create(<DemoVideo youtubeId="gBL3gYNtun0" />);
    });
    expect(mockMounts.map(embedOf)).toEqual(['gBL3gYNtun0']);
  });

  // Reloading a new clip into the same WKWebView hangs YouTube's player on a
  // black frame (seen on an iPhone 12, iOS 27, when the routine moved on to the
  // next exercise with the demo open). Each clip gets a fresh player instead.
  it('starts a fresh player when the clip changes', () => {
    act(() => {
      tree = create(<DemoVideo youtubeId="gBL3gYNtun0" />);
    });
    act(() => tree!.update(<DemoVideo youtubeId="jpW6X3zffuM" />));
    expect(mockMounts.map(embedOf)).toEqual(['gBL3gYNtun0', 'jpW6X3zffuM']);
  });
});
