// The exercise demo on the break screen, as in the extension's break window (extension/lib/demo-panel.js):
// the drawn 3D figure at once (made on the phone, drag to turn it), then the move's demo video from
// the API server in its place once it can play. With no server set, no video for the move or no
// network, the figure stays. The video is asked for only while the demo is open.
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { DemoModel } from '@/src/components/DemoModel';
import { t } from '@/src/core/i18n';
import { demoVideoUrl } from '@/src/core/shared';
import { API_URL } from '../../../extension/config.js';

type Move = { key: string; label: string };

export function ExerciseDemo({ move, lang }: { move: Move; lang: string }) {
  const src = demoVideoUrl(API_URL, move.key);
  // Keyed by move, so each move starts from its figure with a player of its own.
  return src ? <VideoDemo key={move.key} src={src} move={move} lang={lang} /> : <Figure move={move} lang={lang} />;
}

function VideoDemo({ src, move, lang }: { src: string; move: Move; lang: string }) {
  const player = useVideoPlayer(src, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  // Once it has played, a moment of buffering keeps the video; an error goes back to the figure.
  const [played, setPlayed] = React.useState(false);
  React.useEffect(() => {
    if (status === 'readyToPlay') setPlayed(true);
    if (status === 'error') setPlayed(false);
  }, [status]);
  if (!played && status !== 'readyToPlay') return <Figure move={move} lang={lang} />;
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="contain"
      className="bg-card border-border aspect-square w-full overflow-hidden rounded-xl border"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(lang, 'demoClipLabel', { move: move.label })}
    />
  );
}

function Figure({ move, lang }: { move: Move; lang: string }) {
  return (
    <View className="gap-1">
      <DemoModel moveKey={move.key} label={t(lang, 'demoLabel', { move: move.label })} />
      <Text className="text-muted-foreground text-center text-xs">{t(lang, 'demoHint')}</Text>
    </View>
  );
}
