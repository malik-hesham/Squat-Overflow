import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { avatarEmoji } from '@/src/components/avatars';
import { Muted } from '@/src/components/kit';
import { SignInButton } from '@/src/components/GoogleSignIn';
import { fetchBoard, type BoardRow, type Period } from '@/src/core/board';
import { levelName, t } from '@/src/core/i18n';
import { useSession } from '@/src/core/session';
import { LEVELS, companyFromEmail } from '@/src/core/shared';
import type { Profile, Settings } from '@/src/core/store';
import { cn } from '@/lib/utils';

// Your company's board, from the same server API as the extension. The company comes from
// the email of the Google account you signed in with.
export function Leaderboard({ settings, profile, lang }: { settings: Settings; profile: Profile; lang: string }) {
  const [period, setPeriod] = React.useState<Period>('week');
  const [rows, setRows] = React.useState<BoardRow[] | null | undefined>(undefined);
  const session = useSession();
  const email = session?.user.email ?? null;
  const company = companyFromEmail(email);
  const competitive = settings.mode === 'competitive';

  React.useEffect(() => {
    if (!company) return;
    let alive = true;
    setRows(undefined);
    (async () => {
      // The server writes your row from your synced breaks and settings.
      const board = await fetchBoard(period);
      if (alive) setRows(board);
    })();
    return () => {
      alive = false;
    };
    // Refetch when the period, account or your XP changes (not on every token refresh).
  }, [period, email, company, competitive, profile.xp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return <ActivityIndicator />;
  if (!session) {
    return (
      <View className="gap-2">
        <Muted>{t(lang, 'boardNeedsSignIn')}</Muted>
        <SignInButton lang={lang} />
      </View>
    );
  }
  if (!company) return <Muted>{t(lang, 'boardNeedsWorkEmail')}</Muted>;

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
