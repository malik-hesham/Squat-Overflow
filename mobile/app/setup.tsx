// First-run setup and Settings: the extension's options page.
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, I18nManager, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { AVATARS, avatarKey, avatarName, type AvatarKey } from '@/src/components/avatars';
import { Chip, ChipRow, Muted, Section, SwitchRow } from '@/src/components/kit';
import { useAppData } from '@/src/core/AppData';
import { calendarGranted, requestCalendar } from '@/src/core/calendar';
import { deviceLang, leftBoard, settingsSaved } from '@/src/core/engine';
import { areaName, nameText, t } from '@/src/core/i18n';
import { requestNotifications } from '@/src/core/notifications';
import { AREAS, LANGS, THEMES, scheduleSettingsChanged, weekOrder } from '@/src/core/shared';
import { saveSettings, type Settings } from '@/src/core/store';
import { cn } from '@/lib/utils';
import { PALETTES } from '@/src/theme/palettes';

const PRESETS = [30, 45, 60, 90, 120];
const PRESET_KEYS: Record<number, string> = { 30: 'min30', 45: 'min45', 60: 'hr1', 90: 'min90', 120: 'hr2' };
const COMPANY_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_STARTS = [6, 0, 1];

type Form = Pick<
  Settings,
  'intervalMin' | 'areas' | 'activeStart' | 'activeEnd' | 'workdays' | 'weekStart' | 'autoPause' | 'privacy' | 'mode' | 'name' | 'company'
>;

function problem(lang: string, f: Form): string {
  if (!Number.isInteger(f.intervalMin) || f.intervalMin < 1 || f.intervalMin > 240) return t(lang, 'errInterval');
  if (!f.areas.length) return t(lang, 'errAreas');
  if (!f.workdays.length) return t(lang, 'errWorkdays');
  if (!HHMM.test(f.activeStart) || !HHMM.test(f.activeEnd) || f.activeStart >= f.activeEnd) return t(lang, 'errHours');
  if (f.mode === 'competitive') {
    if (!f.name || f.name.length > 40) return t(lang, 'errName');
    if (!COMPANY_RE.test(f.company)) return t(lang, 'errCompany');
  }
  if (f.company && !COMPANY_RE.test(f.company)) return t(lang, 'errCompany');
  return '';
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// Arabic lays the app out right to left. React Native only applies a direction
// change after a restart, so ask for one.
function applyDirection(lang: string) {
  const rtl = lang === 'ar';
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return;
  I18nManager.forceRTL(rtl);
  Alert.alert(t(lang, 'restartTitle'), t(lang, 'restartBody'), [{ text: t(lang, 'ok') }]);
}

export default function SetupScreen() {
  const router = useRouter();
  const { settings, lang } = useAppData();
  const initial = React.useRef(settings).current;
  const firstRun = !initial.setupDone;
  const [form, setForm] = React.useState<Form>({
    intervalMin: initial.intervalMin,
    areas: initial.areas,
    activeStart: initial.activeStart,
    activeEnd: initial.activeEnd,
    workdays: initial.workdays,
    weekStart: initial.weekStart,
    autoPause: initial.autoPause,
    privacy: initial.privacy,
    mode: initial.mode,
    name: initial.name,
    company: initial.company,
  });
  const [custom, setCustom] = React.useState(!PRESETS.includes(initial.intervalMin));
  const [customText, setCustomText] = React.useState(String(initial.intervalMin));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [calError, setCalError] = React.useState(false);
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const err = problem(lang, form);

  async function save() {
    if (err || saving) return;
    setSaving(true);
    try {
      const next = { ...form, name: form.name.trim(), company: form.company.trim().toLowerCase() };
      await requestNotifications();
      await saveSettings({ ...next, setupDone: true });
      await settingsSaved(scheduleSettingsChanged(initial, next));
      if (initial.mode === 'competitive' && next.mode === 'personal') await leftBoard();
      if (firstRun) router.replace('/');
      else setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCalendar() {
    if (settings.calendar) {
      await saveSettings({ calendar: false });
    } else {
      const granted = (await calendarGranted()) || (await requestCalendar());
      setCalError(!granted);
      if (granted) await saveSettings({ calendar: true });
    }
    await settingsSaved(false);
  }

  const days = weekOrder(form.weekStart) as number[];

  return (
    <SafeAreaView className="bg-background flex-1" edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 p-4 pb-32" keyboardShouldPersistTaps="handled">
          <View className="gap-1 pt-2">
            <Text className="text-2xl font-bold">{t(lang, firstRun ? 'welcome' : 'settingsTitle')}</Text>
            {firstRun ? <Muted>{t(lang, 'intro')}</Muted> : null}
          </View>

          <Section title={t(lang, 'profile')}>
            <Muted>{t(lang, 'pickAvatar')}</Muted>
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {(Object.keys(AVATARS) as AvatarKey[]).map((key) => {
                const on = avatarKey(settings.avatar) === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={avatarName(lang, key)}
                    onPress={() => saveSettings({ avatar: key })}
                    className={cn('w-[22%] items-center gap-1 rounded-xl border py-2', on ? 'border-primary bg-primary/15' : 'border-border')}>
                    <Text className="text-3xl">{AVATARS[key].emoji}</Text>
                    <Text numberOfLines={1} className="text-muted-foreground text-[11px]">
                      {avatarName(lang, key)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="gap-1.5">
              <Label nativeID="name">{t(lang, 'displayName')}</Label>
              <Input aria-labelledby="name" value={form.name} maxLength={40} placeholder={t(lang, 'namePlaceholder')} onChangeText={(name) => set({ name })} />
            </View>
            <View className="gap-1.5">
              <Label nativeID="company">{t(lang, 'companyDomain')}</Label>
              <Input
                aria-labelledby="company"
                value={form.company}
                maxLength={100}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={t(lang, 'companyPlaceholder')}
                onChangeText={(company) => set({ company })}
              />
            </View>
          </Section>

          <Section title={t(lang, 'howOften')}>
            <ChipRow>
              {PRESETS.map((m) => (
                <Chip
                  key={m}
                  label={t(lang, PRESET_KEYS[m])}
                  selected={!custom && form.intervalMin === m}
                  onPress={() => {
                    setCustom(false);
                    set({ intervalMin: m });
                  }}
                />
              ))}
              <Chip
                label={t(lang, 'custom')}
                selected={custom}
                onPress={() => {
                  setCustom(true);
                  set({ intervalMin: Number(customText) });
                }}
              />
            </ChipRow>
            {custom ? (
              <View className="flex-row items-center gap-2">
                <Text>{t(lang, 'every')}</Text>
                <Input
                  className="w-20 text-center"
                  keyboardType="number-pad"
                  value={customText}
                  onChangeText={(v) => {
                    setCustomText(v);
                    set({ intervalMin: Number(v) });
                  }}
                />
                <Text>{t(lang, 'minutes')}</Text>
              </View>
            ) : null}
          </Section>

          <Section title={t(lang, 'whereFeel')}>
            <Muted>{t(lang, 'pickAreas')}</Muted>
            <ChipRow>
              {(AREAS as string[]).map((a) => (
                <Chip
                  key={a}
                  label={areaName(lang, a)}
                  hint={t(lang, `areaHint.${a}`)}
                  selected={form.areas.includes(a)}
                  onPress={() => set({ areas: (AREAS as string[]).filter((x) => toggle(form.areas, a).includes(x)) })}
                />
              ))}
            </ChipRow>
          </Section>

          <Section title={t(lang, 'when')}>
            <View className="flex-row items-center gap-2">
              <Text>{t(lang, 'from')}</Text>
              <Input className="w-20 text-center" value={form.activeStart} maxLength={5} keyboardType="numbers-and-punctuation" onChangeText={(activeStart) => set({ activeStart })} />
              <Text>{t(lang, 'to')}</Text>
              <Input className="w-20 text-center" value={form.activeEnd} maxLength={5} keyboardType="numbers-and-punctuation" onChangeText={(activeEnd) => set({ activeEnd })} />
            </View>
            <Muted>{t(lang, 'weekStarts')}</Muted>
            <ChipRow>
              {WEEK_STARTS.map((d) => (
                <Chip key={d} label={t(lang, `weekday.${d}`)} selected={form.weekStart === d} onPress={() => set({ weekStart: d })} />
              ))}
            </ChipRow>
            <ChipRow>
              {days.map((d) => (
                <Chip key={d} label={t(lang, `day.${d}`)} selected={form.workdays.includes(d)} onPress={() => set({ workdays: toggle(form.workdays, d) })} />
              ))}
            </ChipRow>
            <SwitchRow id="autoPause" label={t(lang, 'autoPause')} checked={form.autoPause} onChange={(autoPause) => set({ autoPause })} />
          </Section>

          <Section title={t(lang, 'calendar')}>
            <Button variant={settings.calendar ? 'outline' : 'secondary'} onPress={toggleCalendar}>
              <Text>{t(lang, settings.calendar ? 'calDisconnect' : 'calConnect')}</Text>
            </Button>
            {settings.calendar ? <Text className="text-primary text-sm">✓ {t(lang, 'calConnected')}</Text> : null}
            {calError ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Text className="text-destructive text-sm">{t(lang, 'calDenied')}</Text>
              </Pressable>
            ) : null}
            <Muted>{t(lang, 'calNote')}</Muted>
          </Section>

          <Section title={t(lang, 'camera')}>
            <SwitchRow id="privacy" label={t(lang, 'privacy')} checked={form.privacy} onChange={(privacy) => set({ privacy })} />
            <Muted>{t(lang, 'notice')}</Muted>
          </Section>

          <Section title={t(lang, 'playMode')}>
            <ChipRow>
              {(['personal', 'competitive'] as const).map((m) => (
                <Chip key={m} label={t(lang, m)} selected={form.mode === m} onPress={() => set({ mode: m })} />
              ))}
            </ChipRow>
            <Muted>{t(lang, form.mode === 'competitive' ? 'modeCompetitiveHint' : 'modePersonalHint')}</Muted>
          </Section>

          <Section title={t(lang, 'theme')}>
            <View className="flex-row flex-wrap gap-2">
              {(THEMES as { id: string; name: string; swatch: string[] }[]).map((th) => {
                const on = settings.theme === th.id || (th.id === 'auto' && !(settings.theme in PALETTES));
                return (
                  <Pressable
                    key={th.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => saveSettings({ theme: th.id })}
                    className={cn('w-[48%] flex-row items-center gap-2 rounded-xl border px-3 py-2.5', on ? 'border-primary bg-primary/15' : 'border-border')}>
                    <View className="flex-row">
                      {th.swatch.map((c) => (
                        <View key={c} style={{ backgroundColor: c }} className="border-border -mr-1.5 size-4 rounded-full border" />
                      ))}
                    </View>
                    <Text className="ml-2 flex-1 text-sm" numberOfLines={1}>
                      {nameText(lang, `theme.${th.id}`, th.name)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title={t(lang, 'language')}>
            <ChipRow>
              {(LANGS as string[]).map((l) => (
                <Chip
                  key={l}
                  label={l === 'auto' ? t(lang, 'lang.auto') : l === 'en' ? 'English' : 'العربية'}
                  selected={(settings.lang || 'auto') === l}
                  onPress={async () => {
                    await saveSettings({ lang: l });
                    applyDirection(deviceLang({ lang: l }));
                  }}
                />
              ))}
            </ChipRow>
          </Section>
        </ScrollView>

        <View className="border-border bg-background absolute inset-x-0 bottom-0 gap-2 border-t px-4 pb-8 pt-3">
          {err && !firstRun ? <Text className="text-destructive text-sm">{err}</Text> : null}
          {saved ? <Text className="text-primary text-sm">{t(lang, 'saved')}</Text> : null}
          <View className="flex-row gap-2">
            {!firstRun ? (
              <Button variant="outline" className="flex-1" onPress={() => router.back()}>
                <Text>{t(lang, 'back')}</Text>
              </Button>
            ) : null}
            <Button className="flex-1" disabled={Boolean(err) || saving} onPress={save}>
              <Text>{t(lang, firstRun ? 'getStarted' : 'save')}</Text>
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
