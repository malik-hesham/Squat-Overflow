// Home: the extension's toolbar popup.
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { avatarEmoji } from '@/src/components/avatars';
import { Challenges } from '@/src/components/Challenges';
import { Heatmap } from '@/src/components/Heatmap';
import { Bar, Muted, Section } from '@/src/components/kit';
import { Leaderboard } from '@/src/components/Leaderboard';
import { useAppData } from '@/src/core/AppData';
import { getBusy } from '@/src/core/calendar';
import { breakKind, pause, resume } from '@/src/core/engine';
import { levelName, localeFor, t } from '@/src/core/i18n';
import { notificationsGranted } from '@/src/core/notifications';
import { agenda, dayKey, isActive, levelFor, upcoming, withPeriods } from '@/src/core/shared';

type AgendaItem = { type: 'gap'; minutes: number } | { type: 'meeting'; start: number; end: number; now: boolean; tomorrow: boolean };

function useNow(everyMs = 30_000) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export default function Home() {
  const router = useRouter();
  const { settings, profile, schedule: s, log, activity, lang } = useAppData();
  const now = useNow();
  const [notifyOn, setNotifyOn] = React.useState(true);
  const [meetings, setMeetings] = React.useState<AgendaItem[] | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      void notificationsGranted().then(setNotifyOn);
    }, []),
  );

  React.useEffect(() => {
    if (!settings.calendar) {
      setMeetings(null);
      return;
    }
    void getBusy(true).then((busy) => setMeetings(agenda(busy, Date.now()) as AgendaItem[]));
  }, [settings.calendar, s.nextAt]);

  if (!settings.setupDone) return <Redirect href="/setup" />;

  const hhmm = (at: number) => new Date(at).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' });
  const lv = levelFor(profile.xp);
  const paused = s.pausedUntil > now;
  const p = withPeriods(profile, now);
  const today = dayKey(now);

  let nextText = t(lang, 'notScheduled');
  if (paused) nextText = t(lang, 'pausedUntil', { time: hhmm(s.pausedUntil) });
  else if (s.nextAt && !isActive(now, settings)) {
    const day = new Date(s.nextAt).toLocaleDateString(localeFor(lang), { weekday: 'short' });
    nextText = t(lang, 'outsideHours', { day, time: hhmm(s.nextAt) });
  } else if (s.nextAt) {
    nextText = t(lang, 'nextAt', { time: hhmm(s.nextAt), n: Math.max(0, Math.ceil((s.nextAt - now) / 60_000)) });
  }

  async function startBreak() {
    router.push(`/break?kind=${await breakKind()}`);
  }

  return (
    <SafeAreaView className="bg-background flex-1" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 p-4 pb-12">
        <View className="flex-row items-center gap-3">
          <View className="bg-card border-border size-16 items-center justify-center rounded-2xl border">
            <Text className="text-4xl">{avatarEmoji(settings.avatar)}</Text>
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-lg font-bold">{settings.name || t(lang, 'you')}</Text>
            <View className="flex-row justify-between">
              <Text className="text-sm">{t(lang, 'level', { n: lv.level, name: levelName(lang, lv.level, lv.name) })}</Text>
              <Text className="text-muted-foreground text-xs">
                {lv.next ? t(lang, 'xpOf', { xp: profile.xp, next: lv.next }) : t(lang, 'xpMax', { xp: profile.xp })}
              </Text>
            </View>
            <Bar value={lv.progress} />
          </View>
        </View>

        {s.dueAt != null ? (
          <Section className="border-primary">
            <Text className="text-lg font-bold">{t(lang, 'breakDue')}</Text>
            <Muted>{t(lang, 'breakDueBody')}</Muted>
            <Button onPress={startBreak}>
              <Text>{t(lang, 'startBreak')}</Text>
            </Button>
          </Section>
        ) : null}

        {!notifyOn ? (
          <Pressable onPress={() => Linking.openSettings()}>
            <Section className="border-warn">
              <Text className="text-sm">{t(lang, 'notificationsOff')}</Text>
              <Text className="text-primary text-sm font-semibold">{t(lang, 'openSettings')}</Text>
            </Section>
          </Pressable>
        ) : null}

        <Section title={t(lang, 'nextBreak')}>
          <Text className="text-lg font-semibold">{nextText}</Text>
          {s.shiftedBy > 0 && s.nextAt && !paused ? (
            <Muted>{t(lang, 'shifted', { n: s.shiftedBy, times: (upcoming(s, settings.intervalMin, 3) as number[]).map(hhmm).join(' · ') })}</Muted>
          ) : null}
        </Section>

        {meetings ? (
          <Section title={t(lang, 'upcomingMeetings')}>
            {meetings.length ? (
              meetings.map((m, i) =>
                m.type === 'gap' ? (
                  <Muted key={`gap-${i}`}>{t(lang, 'gapFits', { n: m.minutes })}</Muted>
                ) : (
                  <View key={m.start} className="flex-row items-center justify-between">
                    <Text className="text-sm">
                      {m.now ? `${t(lang, 'meetingNow')} ` : m.tomorrow ? `${t(lang, 'tomorrow')} ` : ''}
                      {hhmm(m.start)} – {hhmm(m.end)}
                    </Text>
                    <Text className={m.now ? 'text-warn text-xs' : 'text-muted-foreground text-xs'}>{m.now ? `● ${t(lang, 'inMeeting')}` : t(lang, 'busy')}</Text>
                  </View>
                ),
              )
            ) : (
              <Muted>{t(lang, 'noMeetings')}</Muted>
            )}
          </Section>
        ) : null}

        <View className="flex-row gap-2">
          {[
            [log.filter((b) => dayKey(b.at) === today).length, t(lang, 'breaksToday')],
            [s.skipsInRow ?? 0, t(lang, 'skipsInRow')],
            [profile.streak, t(lang, 'dayStreak')],
          ].map(([n, label]) => (
            <View key={String(label)} className="bg-card border-border flex-1 items-center gap-0.5 rounded-xl border py-3">
              <Text className="text-2xl font-bold">{n}</Text>
              <Text className="text-muted-foreground text-center text-[11px]">{label}</Text>
            </View>
          ))}
        </View>

        <View className="flex-row flex-wrap gap-2">
          <Button className="w-full" size="lg" onPress={startBreak}>
            <Text>{t(lang, 'breakNow')}</Text>
          </Button>
          <Button variant="secondary" className="flex-1" onPress={() => (paused ? resume() : pause())}>
            <Text>{t(lang, paused ? 'resume' : 'pause')}</Text>
          </Button>
          <Button variant="secondary" className="flex-1" onPress={() => router.push('/setup')}>
            <Text>{t(lang, 'settings')}</Text>
          </Button>
        </View>

        <Section title={t(lang, 'activity')}>
          <Heatmap activity={activity} workdays={settings.workdays} lang={lang} now={now} />
        </Section>

        <Section title={t(lang, 'challenges')}>
          <Challenges profile={p} lang={lang} />
        </Section>

        <Section title={t(lang, 'leaderboard')}>
          <Leaderboard settings={settings} profile={profile} lang={lang} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
