// Reminders as local notifications: the planned reminder times (plan.ts) are
// handed to the OS, which shows them even when the app isn't running.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Planned } from './plan';
import { t } from './i18n';
import { WARN_SKIPS, warningHours } from './shared';

export const CHANNEL = 'breaks';
export const ACTION = { start: 'start', snooze: 'snooze', skip: 'skip' } as const;
const CATEGORY = { full: 'break', noSnooze: 'break-no-snooze' } as const;
// iOS keeps at most 64 pending local notifications per app.
export const MAX_PLANNED = 48;

export type ReminderData = { kind: 'reminder'; at: number };

let configuredLang: string | null = null;

// Banners also show while the app is open: a reminder is a reminder.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function configure(lang: string): Promise<void> {
  if (configuredLang === lang) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: t(lang, 'breakReminders'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
    });
  }
  // Every action opens the app: background actions don't reliably run JS
  // when the app was killed, and the app must record the answer.
  const start = { identifier: ACTION.start, buttonTitle: t(lang, 'startBreak'), options: { opensAppToForeground: true } };
  const snooze = { identifier: ACTION.snooze, buttonTitle: t(lang, 'snooze'), options: { opensAppToForeground: true } };
  const skip = { identifier: ACTION.skip, buttonTitle: t(lang, 'skip'), options: { opensAppToForeground: true, isDestructive: true } };
  await Notifications.setNotificationCategoryAsync(CATEGORY.full, [start, snooze, skip]);
  await Notifications.setNotificationCategoryAsync(CATEGORY.noSnooze, [start, skip]);
  configuredLang = lang;
}

export async function notificationsGranted(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

function content(p: Planned, lang: string, intervalMin: number, areas: string[]) {
  const warn = p.skipsInRow >= WARN_SKIPS;
  return {
    title: warn ? t(lang, 'warnTitle', { n: warningHours(p.skipsInRow, intervalMin) }) : t(lang, 'timeToMove'),
    body: warn ? t(lang, 'reminderWarnBody') : t(lang, 'reminderBody', { areas: areas.join(' · ') || t(lang, 'reminderAnyArea') }),
    data: { kind: 'reminder', at: p.at } satisfies ReminderData,
    categoryIdentifier: p.canSnooze ? CATEGORY.full : CATEGORY.noSnooze,
    sound: true,
  };
}

// Replaces every pending reminder with `planned`.
export async function scheduleReminders(
  planned: Planned[],
  { lang, intervalMin, areas }: { lang: string; intervalMin: number; areas: string[] },
): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!planned.length || !(await notificationsGranted())) return 0;
  await configure(lang);
  const now = Date.now();
  let n = 0;
  for (const p of planned.slice(0, MAX_PLANNED)) {
    if (p.at <= now) continue;
    await Notifications.scheduleNotificationAsync({
      content: content(p, lang, intervalMin, areas),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL },
    });
    n++;
  }
  return n;
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export function reminderOf(response: Notifications.NotificationResponse): ReminderData | null {
  const data = response.notification.request.content.data as Partial<ReminderData> | undefined;
  return data?.kind === 'reminder' && typeof data.at === 'number' ? (data as ReminderData) : null;
}
