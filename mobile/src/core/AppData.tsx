// Everything the screens show, loaded once and refreshed whenever storage
// changes (the extension's pages re-render on chrome.storage.onChanged).
// It also keeps the signed-in account in sync: on launch, on sign-in, on
// returning to the foreground and every minute while open.
import * as React from 'react';
import { AppState } from 'react-native';

import { deviceLang, syncAccount } from './engine';
import type { Schedule } from './plan';
import { useSession } from './session';
import { backfillActivity } from './shared';
import { subscribe } from './storage';
import {
  getActivity,
  getProfile,
  getSchedule,
  getSettings,
  readLog,
  type Activity,
  type LogEntry,
  type Profile,
  type Settings,
} from './store';

export type AppData = {
  settings: Settings;
  profile: Profile;
  schedule: Schedule;
  log: LogEntry[];
  activity: Activity;
  lang: string;
};

const Ctx = React.createContext<AppData | null>(null);

async function loadAll(): Promise<AppData> {
  const [settings, profile, schedule, log, activity] = await Promise.all([
    getSettings(),
    getProfile(),
    getSchedule(),
    readLog(),
    getActivity(),
  ]);
  return { settings, profile, schedule, log, activity: activity ?? (backfillActivity(log) as Activity), lang: deviceLang(settings) };
}

const SYNC_EVERY_MS = 60_000;

function useAccountSync() {
  const session = useSession();
  const account = session?.user?.id ?? null;
  React.useEffect(() => {
    if (!account) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void syncAccount();
      timer ??= setInterval(() => void syncAccount(), SYNC_EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active' || AppState.currentState == null) start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [account]);
}

export function AppDataProvider({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [data, setData] = React.useState<AppData | null>(null);
  useAccountSync();
  React.useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      loadAll().then((d) => alive && mine === seq && setData(d));
    };
    load();
    const unsubscribe = subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  if (!data) return <>{fallback ?? null}</>;
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const data = React.useContext(Ctx);
  if (!data) throw new Error('useAppData outside AppDataProvider');
  return data;
}
