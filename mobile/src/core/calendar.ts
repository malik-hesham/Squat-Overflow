// Busy times from the phone's own calendars (Google, Outlook, iCloud... whatever
// the user synced), so reminders wait until meetings end. Only start and end
// times are kept, never titles or details, matching the extension's freeBusy use.
import { Availability, EntityTypes, getCalendarPermissions, getCalendars, listEvents, requestCalendarPermissions } from 'expo-calendar';

import type { Busy } from './plan';
import { getItem, setItems } from './storage';

const BUSY_KEY = 'calendarBusy';
const CACHE_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
const LOOKAHEAD_MS = 7 * 24 * HOUR_MS;

type Cached = { fetchedAt: number; busy: Busy[] };

export async function calendarGranted(): Promise<boolean> {
  try {
    return (await getCalendarPermissions()).granted;
  } catch {
    return false;
  }
}

export async function requestCalendar(): Promise<boolean> {
  try {
    return (await requestCalendarPermissions()).granted;
  } catch {
    return false;
  }
}

const toMs = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d));

async function readBusy(now: number): Promise<Busy[]> {
  const calendars = await getCalendars(EntityTypes.EVENT);
  if (!calendars.length) return [];
  const events = await listEvents(calendars, new Date(now - HOUR_MS), new Date(now + LOOKAHEAD_MS));
  return events
    .filter((e) => !e.allDay && e.availability !== Availability.FREE)
    .map((e) => ({ start: toMs(e.startDate), end: toMs(e.endDate) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

// Busy blocks for the next week, cached for 10 minutes. Empty when the user
// hasn't connected the calendar or took the permission back.
export async function getBusy(enabled: boolean, now = Date.now(), { fresh = false } = {}): Promise<Busy[]> {
  if (!enabled || !(await calendarGranted())) return [];
  const cached = await getItem<Cached>(BUSY_KEY);
  if (!fresh && cached && now - cached.fetchedAt < CACHE_MS) return cached.busy;
  try {
    const busy = await readBusy(now);
    await setItems({ [BUSY_KEY]: { fetchedAt: now, busy } });
    return busy;
  } catch {
    return cached?.busy ?? [];
  }
}
