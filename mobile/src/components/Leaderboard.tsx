import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { avatarEmoji } from '@/src/components/avatars';
import { Muted } from '@/src/components/kit';
import { levelName, t } from '@/src/core/i18n';
import { LEVELS, fetchBoard, submitScore } from '@/src/core/shared';
import type { Profile, Settings } from '@/src/core/store';
import { cn } from '@/lib/utils';

type Row = { rank: number; name: string; level: number; xp: number; streak: number; avatar: string; is_me: boolean };
type Period = 'week' | 'all';

// The company board, read through the same Supabase functions as the extension.
export function Leaderboard({ settings, profile, lang }: { settings: Settings; profile: Profile; lang: string }) {
  const [period, setPeriod] = React.useState<Period>('week');
  const [rows, setRows] = React.useState<Row[] | null | undefined>(undefined);
  const competitive = settings.mode === 'competitive';

  React.useEffect(() => {
    if (!settings.company) return;
    let alive = true;
    setRows(undefined);
    (async () => {
      if (competitive) await submitScore(profile, settings);
      const board = (await fetchBoard(settings.company, period, profile.playerId)) as Row[] | null;
      if (alive) setRows(board);
    })();
    return () => {
      alive = false;
    };
    // Refetch when the period, company or your XP changes.
  }, [period, settings.company, competitive, profile.xp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings.company) return <Muted>{t(lang, 'boardNeedsCompany')}</Muted>;

  return (
    <View className="gap-3">
      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList className="w-full">
          <TabsTrigger value="week" className="flex-1">
            <Text>{t(lang, 'thisWeek')}</Text>
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1">
            <Text>{t(lang, 'allTime')}</Text>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {rows === undefined ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator />
          <Muted>{t(lang, 'loading')}</Muted>
        </View>
      ) : rows === null ? (
        <Muted>{t(lang, 'boardUnavailable')}</Muted>
      ) : (
        <View className="gap-1.5">
          {rows.map((r) => (
            <View key={`${r.rank}-${r.name}`} className={cn('flex-row items-center gap-3 rounded-lg px-2 py-1.5', r.is_me && 'bg-primary/15')}>
              <Text className="text-muted-foreground w-8 text-xs">#{r.rank}</Text>
              <Text className="text-2xl">{avatarEmoji(r.avatar)}</Text>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-sm font-medium">
                  {r.name}
                </Text>
                <Text numberOfLines={1} className="text-muted-foreground text-xs">
                  {levelName(lang, r.level, LEVELS[r.level - 1]?.name ?? '')}
                </Text>
              </View>
              <Text className="text-xs font-semibold">
                {r.xp} XP · 🔥{r.streak}
              </Text>
            </View>
          ))}
          {!rows.length ? <Muted>{t(lang, 'boardEmpty')}</Muted> : null}
          {!competitive ? <Muted>{t(lang, 'boardPrivate')}</Muted> : null}
        </View>
      )}
    </View>
  );
}
