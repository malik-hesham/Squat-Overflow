import '@/src/core/polyfills';
import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { AppState } from 'react-native';

import { AppDataProvider, useAppData } from '@/src/core/AppData';
import { breakAction, sync } from '@/src/core/engine';
import { ACTION, reminderOf } from '@/src/core/notifications';
import { getSchedule } from '@/src/core/store';
import { ThemeRoot } from '@/src/theme/ThemeRoot';

export { ErrorBoundary } from 'expo-router';

// Catch up on delivered reminders whenever the app comes back, and route
// taps on a reminder (or its Snooze / Skip buttons) to the right place.
function useReminders() {
  const router = useRouter();
  const handled = React.useRef(new Set<string>());
  const response = Notifications.useLastNotificationResponse();

  React.useEffect(() => {
    void sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    // A reminder delivered while the app is open: catch up right away so the
    // "break is due" card (and any skip it implies) shows without a relaunch.
    const received = Notifications.addNotificationReceivedListener((n) => {
      if ((n.request.content.data as { kind?: string } | undefined)?.kind === 'reminder') void sync();
    });
    return () => {
      sub.remove();
      received.remove();
    };
  }, []);

  React.useEffect(() => {
    if (!response) return;
    const reminder = reminderOf(response);
    const id = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (!reminder || handled.current.has(id)) return;
    handled.current.add(id);
    void (async () => {
      await sync();
      const s = await getSchedule();
      const current = s.dueAt === reminder.at; // an old reminder's buttons don't touch a newer one
      if (response.actionIdentifier === ACTION.snooze || response.actionIdentifier === ACTION.skip) {
        if (current) await breakAction(response.actionIdentifier);
        router.navigate('/');
        return;
      }
      router.navigate(current ? '/break?kind=reminder' : '/break?kind=manual');
    })();
  }, [response, router]);
}

function Shell() {
  const { settings } = useAppData();
  useReminders();
  return (
    <ThemeRoot theme={settings.theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        {/* A pushed screen rather than a native full-screen modal, which loses the safe-area insets. */}
        <Stack.Screen name="break" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      </Stack>
      <PortalHost />
    </ThemeRoot>
  );
}

export default function RootLayout() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
