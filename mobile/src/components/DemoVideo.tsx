// The exercise demo clip on the break screen: YouTube's privacy-enhanced
// player with the same parameters as the pose server's /embed page, which the
// extension's break window shows.
import * as React from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

function demoHtml(id: string) {
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&modestbranding=1&playsinline=1&rel=0`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe src="${src}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

export function DemoVideo({ youtubeId }: { youtubeId: string }) {
  return (
    <View className="aspect-video overflow-hidden rounded-xl bg-black">
      {/* One WebView per clip: loading a new clip into the same WKWebView left
          YouTube's player stuck on a black frame when the routine moved on. */}
      <WebView
        key={youtubeId}
        source={{ html: demoHtml(youtubeId), baseUrl: 'https://squatoverflow.app' }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        scrollEnabled={false}
        style={{ backgroundColor: '#000' }}
      />
    </View>
  );
}
