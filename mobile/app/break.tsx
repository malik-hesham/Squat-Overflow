// The break: the extension's reminder window (extension/break.js). A warning
// after three skips, the camera-coached routine, and the XP summary.
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, BackHandler, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { Bar, Muted } from '@/src/components/kit';
import { useAppData } from '@/src/core/AppData';
import { breakAction, breakDone, type BreakResult, type DoneOutcome } from '@/src/core/engine';
import { areaName, exerciseText, issueText, levelName, nameText, t } from '@/src/core/i18n';
import {
  AREAS,
  BREAK_REPS,
  badgeLabel,
  breakXp,
  buildRoutine,
  canSnooze,
  featuredArea,
  levelFor,
  needsPositioning,
  nextOpenMove,
  repMarks,
  showWarning,
  swapMove,
  warningHours,
} from '@/src/core/shared';
import { createSounds, type Sounds } from '@/src/core/sounds';
import { saveSettings } from '@/src/core/store';
import { exerciseCatalog } from '@/src/pose/analysis';
import { PoseCamera } from '@/src/pose/PoseCamera';
import type { CoachStatus, FrameResult } from '@/src/pose/types';
import { cn } from '@/lib/utils';

const POSITION_TIMEOUT_MS = 15_000;
const CAMERA_SLOW_MS = 6_000;
const YOUTUBE_ID = /^[\w-]{11}$/;

type Move = {
  key: string;
  label: string;
  area: string;
  camera: string;
  stance: string;
  how_to: string;
  demo: { youtube_id: string } | null;
  target: number;
};
type Progress = { reps: number; scores: number[]; base: number };
type CatalogItem = Move & { category: string };
type Screen = 'warning' | 'routine' | 'summary';

function demoHtml(id: string) {
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&modestbranding=1&playsinline=1&rel=0`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe src="${src}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

export default function BreakScreen() {
  useKeepAwake();
  const router = useRouter();
  const navigation = useNavigation();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const manual = kind !== 'reminder';
  const { settings, schedule, profile, lang } = useAppData();
  const opened = React.useRef({ schedule, settings }).current; // the state this break opened with

  // Routine state lives in a ref (it changes on every analysed frame) and a
  // counter re-renders the screen.
  const [, setTick] = React.useState(0);
  const rerender = () => setTick((n) => n + 1);
  const st = React.useRef({
    catalog: [] as CatalogItem[],
    moves: [] as Move[],
    progress: [] as Progress[],
    i: 0,
    started: false,
    finished: false,
    answered: false,
    positioning: false,
    positionTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    repMarks: [] as number[],
    repMemes: 0,
  }).current;
  const sounds = React.useRef<Sounds | null>(null);
  const prefs = React.useRef({ voice: settings.voice, memes: settings.memes });
  const [screen, setScreen] = React.useState<Screen>(() => (!manual && showWarning(opened.schedule) ? 'warning' : 'routine'));
  const [status, setStatus] = React.useState<CoachStatus | 'simulated'>('starting');
  const [slow, setSlow] = React.useState(false);
  const [lastScore, setLastScore] = React.useState<number | null>(null);
  const [cue, setCue] = React.useState<{ text: string; good: boolean } | null>(null);
  const [voice, setVoice] = React.useState(settings.voice);
  const [memes, setMemes] = React.useState(settings.memes);
  const [privacy, setPrivacy] = React.useState(settings.privacy);
  const [demo, setDemo] = React.useState(false);
  const [outcome, setOutcome] = React.useState<DoneOutcome | null>(null);
  const snoozeOk = canSnooze(opened.schedule);
  const fallback = status === 'offline' || status === 'camera-denied';

  // ---- Setup -------------------------------------------------------------
  if (!st.catalog.length) {
    st.catalog = exerciseCatalog().map((e) => ({
      ...(e as unknown as CatalogItem),
      label: exerciseText(lang, e.key, 'label', e.label),
      how_to: exerciseText(lang, e.key, 'how_to', e.how_to),
    }));
    st.moves = buildRoutine(st.catalog, {
      areas: settings.areas.length ? settings.areas : (AREAS as string[]).slice(0, 2),
      featured: featuredArea(Date.now()),
      lastKey: opened.schedule.lastKey,
      n: opened.schedule.breakCount,
    }) as Move[];
    st.progress = st.moves.map(() => ({ reps: 0, scores: [], base: 0 }));
    st.repMarks = repMarks(st.moves.reduce((n, m) => n + m.target, 0)) as number[];
  }

  React.useEffect(() => {
    let alive = true;
    void createSounds({ lang, voice: () => prefs.current.voice, memes: () => prefs.current.memes }).then((s) => {
      if (!alive) return;
      sounds.current = s;
      if (screen === 'routine') startRoutine(manual);
    });
    return () => {
      alive = false;
      sounds.current?.stopSpeech();
      clearTimeout(st.positionTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Starting the camera can take a while the first time (model load).
  React.useEffect(() => {
    if (status !== 'starting' || screen !== 'routine') return;
    setSlow(false);
    const id = setTimeout(() => setSlow(true), CAMERA_SLOW_MS);
    return () => clearTimeout(id);
  }, [status, screen]);

  // ---- Leaving -----------------------------------------------------------
  const leaveWithoutAnswer = React.useCallback(() => {
    if (st.finished || manual) {
      router.back();
      return;
    }
    Alert.alert(t(lang, 'leaveBreakTitle'), t(lang, 'leaveBreakBody'), [
      { text: t(lang, 'stay'), style: 'cancel' },
      {
        text: t(lang, 'leave'),
        style: 'destructive',
        onPress: async () => {
          st.finished = true;
          await breakAction('close');
          router.back();
        },
      },
    ]);
  }, [lang, manual, router, st]);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveWithoutAnswer();
      return true;
    });
    return () => sub.remove();
  }, [leaveWithoutAnswer]);

  React.useEffect(() => navigation.setOptions({ gestureEnabled: false }), [navigation]);

  // ---- Routine -----------------------------------------------------------
  const move = st.moves[st.i];

  function speak(text: string) {
    sounds.current?.speak(text);
  }

  function announce(i: number) {
    const m = st.moves[i];
    if (m) speak(t(lang, i ? 'sayNext' : 'sayMove', { label: m.label, n: m.target }));
  }

  function currentResult(): BreakResult {
    const scores = st.progress.flatMap((p) => p.scores);
    return {
      scored: scores.length > 0,
      countedReps: st.progress.reduce((n, p) => n + p.reps, 0),
      targetReps: st.moves.reduce((n, m) => n + m.target, 0),
      scores,
      moves: st.moves.map((m, k) => ({ key: m.key, area: m.area, completed: st.progress[k].reps >= m.target })),
    };
  }

  function endPositioning() {
    clearTimeout(st.positionTimer);
    st.positioning = false;
  }

  function showMove(i: number, coachUp = !fallback) {
    st.i = i;
    st.progress[i].base = st.progress[i].reps;
    setLastScore(null);
    setCue(null);
    clearTimeout(st.positionTimer);
    st.positioning = needsPositioning(st.moves[i]) && coachUp;
    if (st.positioning) {
      st.positionTimer = setTimeout(() => {
        endPositioning();
        rerender();
      }, POSITION_TIMEOUT_MS);
    }
    rerender();
  }

  function startRoutine(withMeme: boolean) {
    if (st.started) return; // effects can re-run (e.g. fast refresh); never restart a routine in progress
    st.started = true;
    if (withMeme) sounds.current?.meme('start');
    setScreen('routine');
    if (!st.moves.length) {
      setStatus('offline');
      return;
    }
    showMove(0);
    announce(0);
  }

  function selectMove(k: number) {
    if (st.finished || k === st.i) return;
    showMove(k);
    announce(k);
  }

  function swap() {
    const m = swapMove(st.catalog, st.moves, st.i) as Move | null;
    if (!m) return;
    st.moves[st.i] = m;
    st.progress[st.i] = { reps: 0, scores: [], base: 0 };
    showMove(st.i);
    announce(st.i);
  }

  const onFrame = React.useCallback((msg: FrameResult) => {
    if (st.finished) return;
    const m = st.moves[st.i];
    if (!m || msg.exercise !== m.key) return;
    if (st.positioning && !msg.feedback.some((f) => f.code === 'not_visible')) endPositioning();
    const p = st.progress[st.i];
    const was = p.reps;
    p.reps = Math.min(p.base + msg.summary.reps, m.target);
    // Rep clips are spread over the whole break; on the last rep the Done clip queues after it.
    if (st.progress.reduce((n, q) => n + q.reps, 0) >= (st.repMarks[st.repMemes] ?? Infinity)) {
      st.repMemes++;
      sounds.current?.meme('reps');
    }
    if (msg.rep_event) {
      const { score, partial } = msg.rep_event;
      p.scores.push(score);
      setLastScore(score);
      const code = msg.rep_event.issues?.[0];
      const english = msg.rep_event.issue_text?.[0];
      const issue = english === undefined || code === undefined ? undefined : issueText(lang, code, english);
      const text = issue ?? (score >= 85 ? t(lang, 'greatForm') : '');
      setCue(text ? { text, good: !issue } : null);
      if (!partial) void Haptics.impactAsync(issue ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
      speak(partial ? t(lang, 'goDeeper') : (issue ?? String(p.reps)));
    }
    if (was < m.target && p.reps >= m.target) {
      const next = nextOpenMove(st.moves, st.progress, st.i);
      if (next === -1) void finish();
      else {
        showMove(next);
        announce(next);
      }
      return;
    }
    rerender();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onStatus = React.useCallback((s: CoachStatus | 'simulated') => {
    if (st.finished) return;
    if (s === 'offline' || s === 'camera-denied') {
      endPositioning();
      setDemo(false);
    }
    setStatus(s);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    if (st.finished) return;
    st.finished = true;
    st.answered = true;
    endPositioning();
    const result = currentResult();
    sounds.current?.meme(result.scored ? 'done' : 'unscored');
    speak(t(lang, 'sayDone'));
    rerender();
    const res = await breakDone(result, st.moves.at(-1)?.key ?? null);
    setOutcome(res);
    setScreen('summary');
  }

  async function leave(action: 'snooze' | 'skip' | 'pause') {
    if (st.finished) return;
    st.finished = true;
    st.answered = true;
    await breakAction(action);
    router.back();
  }

  async function togglePref(key: 'voice' | 'memes', value: boolean) {
    prefs.current[key] = value;
    if (key === 'voice') {
      setVoice(value);
      if (!value) sounds.current?.stopSpeech();
      else announce(st.i);
    } else setMemes(value);
    await saveSettings({ [key]: value });
  }

  async function togglePrivacy(value: boolean) {
    setPrivacy(value);
    await saveSettings({ privacy: value });
  }

  // ---- Render ------------------------------------------------------------
  const totalTarget = st.moves.reduce((n, m) => n + m.target, 0) || 1;
  const totalDone = st.progress.reduce((n, q) => n + q.reps, 0);
  const progress = move ? st.progress[st.i] : null;
  const demoId = move?.demo && YOUTUBE_ID.test(move.demo.youtube_id) && !fallback ? move.demo.youtube_id : null;

  if (screen === 'summary' && outcome) {
    return <Summary outcome={outcome} lang={lang} onBack={() => router.back()} />;
  }

  return (
    <SafeAreaView className="bg-background flex-1" edges={['top', 'left', 'right', 'bottom']}>
      <View className="gap-2 px-4 pb-2 pt-1">
        <View className="flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel={t(lang, 'back')} hitSlop={12} onPress={leaveWithoutAnswer}>
            <Text className="text-muted-foreground text-2xl">✕</Text>
          </Pressable>
          <Text className="text-muted-foreground text-sm">
            {screen === 'warning'
              ? t(lang, 'skippedInRow', { n: opened.schedule.skipsInRow })
              : move
                ? t(lang, 'exerciseStep', { i: st.i + 1, n: st.moves.length })
                : t(lang, 'break')}
          </Text>
          <Text className="text-gold font-bold">+{breakXp(currentResult())} XP</Text>
        </View>
        {screen === 'routine' && move ? (
          <>
            <View className="flex-row items-center gap-2">
              <View className="bg-secondary rounded-full px-2.5 py-0.5">
                <Text className="text-xs">{areaName(lang, move.area)}</Text>
              </View>
            </View>
            <Text className="text-2xl font-bold">{move.label}</Text>
            <Bar value={totalDone / totalTarget} />
            <View className="flex-row gap-2">
              {st.moves.map((m, k) => {
                const reps = st.progress[k].reps;
                const done = reps >= m.target;
                return (
                  <Pressable
                    key={`${m.key}-${k}`}
                    onPress={() => selectMove(k)}
                    accessibilityState={{ selected: k === st.i }}
                    className={cn('flex-1 rounded-lg border px-2 py-1.5', k === st.i ? 'border-primary' : 'border-border', done && 'bg-primary/15')}>
                    <Text numberOfLines={1} className="text-xs font-medium">
                      {m.label}
                    </Text>
                    <Text className="text-muted-foreground text-[11px]">{done ? '✓' : `${reps}/${m.target}`}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
        {screen === 'routine' && !move ? <Text className="text-2xl font-bold">{t(lang, 'timeToMove')}</Text> : null}
      </View>

      {screen === 'warning' ? (
        <View className="flex-1 justify-center gap-4 px-6">
          <Text className="text-center text-5xl">⚠️</Text>
          <Text className="text-center text-2xl font-bold">{t(lang, 'warnTitle', { n: warningHours(opened.schedule.skipsInRow, opened.settings.intervalMin) })}</Text>
          <Muted className="text-center">{t(lang, 'warnBody')}</Muted>
          <Button size="lg" onPress={() => startRoutine(true)}>
            <Text>{t(lang, 'warnStart')}</Text>
          </Button>
          <Button variant="secondary" disabled={!snoozeOk} onPress={() => leave('snooze')}>
            <Text>{t(lang, snoozeOk ? 'snooze' : 'snoozedTwice')}</Text>
          </Button>
          <Button variant="secondary" onPress={() => leave('pause')}>
            <Text>{t(lang, 'pause')}</Text>
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-3 px-4 pb-4">
          <View className="bg-card border-border aspect-[4/5] overflow-hidden rounded-2xl border">
            {move && !st.finished ? (
              <PoseCamera exercise={move.key} active={screen === 'routine' && !fallback} privacy={privacy} onFrame={onFrame} onStatus={onStatus} />
            ) : null}
            <View className="absolute left-3 top-3 flex-row items-baseline rounded-xl bg-black/55 px-3 py-1.5" style={{ direction: 'ltr' }}>
              <Text className="text-3xl font-bold text-white">{progress?.reps ?? 0}</Text>
              <Text className="text-lg text-white/80"> / {move?.target ?? BREAK_REPS}</Text>
            </View>
            {lastScore != null ? (
              <View className="bg-primary absolute right-3 top-3 rounded-xl px-3 py-1.5">
                <Text className="text-primary-foreground font-bold">{t(lang, 'form', { score: lastScore })}</Text>
              </View>
            ) : null}
            {cue ? (
              <View className={cn('absolute inset-x-3 bottom-3 rounded-xl px-3 py-2', cue.good ? 'bg-primary/90' : 'bg-warn/90')}>
                <Text className="text-center font-semibold text-black">{cue.text}</Text>
              </View>
            ) : null}
            {st.positioning && !fallback ? (
              <Overlay title={t(lang, 'getInPosition')} body={t(lang, 'positionText')} />
            ) : null}
            {status === 'starting' && !fallback && move ? (
              <Overlay title={t(lang, 'startingCamera')} body={t(lang, slow ? 'cameraSlow' : 'framesLocal')} />
            ) : null}
            {fallback || !move ? (
              <Overlay
                title={t(lang, status === 'offline' || !move ? 'coachOffline' : 'cameraUnavailable')}
                body={t(lang, status === 'offline' || !move ? 'offlineText' : 'deniedText')}
              />
            ) : null}
          </View>

          {status === 'simulated' ? <Muted className="text-warn">{t(lang, 'simulated')}</Muted> : null}

          <View className="gap-1">
            <Text className="leading-6">{move ? move.how_to : t(lang, 'manualHowto')}</Text>
            {move?.camera === 'side' ? <Muted>{t(lang, 'cameraHint')}</Muted> : null}
          </View>

          <View className="flex-row flex-wrap gap-2">
            {move && swapMove(st.catalog, st.moves, st.i) ? (
              <Button variant="outline" size="sm" onPress={swap}>
                <Text>{t(lang, 'swap')}</Text>
              </Button>
            ) : null}
            {demoId ? (
              <Button variant="outline" size="sm" onPress={() => setDemo((d) => !d)}>
                <Text>{t(lang, demo ? 'hideDemo' : 'watchDemo')}</Text>
              </Button>
            ) : null}
          </View>

          {demo && demoId ? (
            <View className="aspect-video overflow-hidden rounded-xl bg-black">
              <WebView
                source={{ html: demoHtml(demoId), baseUrl: 'https://squatoverflow.app' }}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                scrollEnabled={false}
                style={{ backgroundColor: '#000' }}
              />
            </View>
          ) : null}

          <View className="bg-card border-border gap-3 rounded-xl border p-3">
            <PrefRow label={t(lang, 'voiceCues')} value={voice} onChange={(v) => togglePref('voice', v)} />
            <PrefRow label={t(lang, 'memeSounds')} value={memes} onChange={(v) => togglePref('memes', v)} />
            <PrefRow label={`${t(lang, 'look')} ${t(lang, 'lookSkeleton')}`} value={privacy} onChange={togglePrivacy} />
          </View>
        </ScrollView>
      )}

      {screen === 'routine' ? (
        <View className="border-border gap-2 border-t px-4 pt-3">
          <Button size="lg" disabled={st.finished} onPress={finish}>
            <Text>{t(lang, 'done')}</Text>
          </Button>
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" disabled={st.finished || !snoozeOk} onPress={() => leave('snooze')}>
              <Text numberOfLines={1}>{t(lang, snoozeOk ? 'snooze' : 'snoozedTwice')}</Text>
            </Button>
            <Button variant="secondary" className="flex-1" disabled={st.finished} onPress={() => leave('skip')}>
              <Text>{t(lang, 'skip')}</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Overlay({ title, body }: { title: string; body: string }) {
  return (
    <View className="absolute inset-0 items-center justify-center gap-2 bg-black/60 px-6">
      <Text className="text-center text-lg font-bold text-white">{title}</Text>
      <Text className="text-center text-sm text-white/85">{body}</Text>
    </View>
  );
}

function PrefRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm">{label}</Text>
      <Switch checked={value} onCheckedChange={onChange} />
    </View>
  );
}

// ---- Summary ---------------------------------------------------------------

function useCountUp(to: number, ms = 900) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / ms);
      setN(Math.round(to * k));
      if (k >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [to, ms]);
  return n;
}

const CONFETTI = ['#3ddc97', '#ffd166', '#5aa9ff', '#ff6b6b', '#c792ea'];

function ConfettiPiece({ k }: { k: number }) {
  const y = useSharedValue(-20);
  const left = React.useMemo(() => Math.random() * 100, []);
  const delay = React.useMemo(() => Math.random() * 600, []);
  React.useEffect(() => {
    y.value = withDelay(delay, withTiming(700, { duration: 1800 }));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${y.value}deg` }], opacity: y.value > 600 ? 0 : 1 }));
  return <Animated.View style={[{ position: 'absolute', top: 0, left: `${left}%`, width: 8, height: 12, borderRadius: 2, backgroundColor: CONFETTI[k % CONFETTI.length] }, style]} />;
}

function Summary({ outcome, lang, onBack }: { outcome: DoneOutcome; lang: string; onBack: () => void }) {
  const { breakdown, levelUp, newBadges, profile } = outcome;
  const total = useCountUp(breakdown.total);
  const lv = levelFor(profile.xp);
  const before = levelFor(profile.xp - breakdown.total);
  const bar = useSharedValue(levelUp ? 0 : before.progress);
  React.useEffect(() => {
    bar.value = withDelay(200, withTiming(lv.progress, { duration: 900 }));
  }, [bar, lv.progress]);
  const barStyle = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));

  const challengeName = (c: { id: string; name: string }) =>
    c.id === 'weekly' ? t(lang, 'areaWeek', { area: areaName(lang, profile.weekly?.area ?? '') }) : nameText(lang, `challenge.${c.id}`, c.name);
  const lines: [string, number | null][] = (
    [
      [t(lang, 'break'), breakdown.breakXp],
      [t(lang, 'firstBreak'), breakdown.firstBreak],
      [t(lang, 'streakBonus'), breakdown.streak],
      ...breakdown.challenges.map((c) => [t(lang, 'challengeLine', { name: challengeName(c) }), c.bonus] as [string, number]),
    ] as [string, number][]
  ).filter(([, v]) => v > 0);
  if (!lines.length) lines.push([t(lang, 'noReps'), 0]);
  for (const id of newBadges) lines.push([t(lang, 'newBadge', { name: badgeLabel(id, lang) }), null]);

  return (
    <SafeAreaView className="bg-background flex-1">
      {levelUp ? (
        <View pointerEvents="none" className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 48 }, (_, k) => (
            <ConfettiPiece key={k} k={k} />
          ))}
        </View>
      ) : null}
      <Animated.View entering={FadeIn} className="flex-1 justify-center gap-5 px-6">
        <Text className="text-muted-foreground text-center">{t(lang, 'breakComplete')}</Text>
        <Text className="text-gold text-center text-6xl font-extrabold">+{total} XP</Text>
        <View className="gap-2">
          {lines.map(([label, v], k) => (
            <View key={k} className="border-border flex-row justify-between border-b pb-2">
              <Text className="flex-1">{label}</Text>
              {v !== null ? <Text className="font-bold">+{v}</Text> : null}
            </View>
          ))}
        </View>
        {levelUp ? <Text className="text-primary text-center text-xl font-bold">{t(lang, 'levelUp', { name: levelName(lang, levelUp.to, levelUp.name) })}</Text> : null}
        <View className="gap-2">
          <View className="flex-row justify-between">
            <Text className="font-bold">{t(lang, 'level', { n: lv.level, name: levelName(lang, lv.level, lv.name) })}</Text>
            <Muted>{lv.next ? t(lang, 'xpOf', { xp: profile.xp, next: lv.next }) : t(lang, 'xpMaxLevel', { xp: profile.xp })}</Muted>
          </View>
          <View className="bg-secondary h-2.5 overflow-hidden rounded-full">
            <Animated.View className="bg-primary h-full rounded-full" style={barStyle} />
          </View>
        </View>
        <Button size="lg" onPress={onBack}>
          <Text>{t(lang, 'backToWork')}</Text>
        </Button>
      </Animated.View>
    </SafeAreaView>
  );
}
