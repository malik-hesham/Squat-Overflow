import { ThemeProvider, DarkTheme, DefaultTheme, type Theme } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, vars } from 'nativewind';
import * as React from 'react';
import { useColorScheme as useSystemScheme, View } from 'react-native';

import { PALETTES, type PaletteId } from './palettes';

// "auto" follows the phone: Daylight in light mode, Midnight Gym in dark mode,
// like the extension's prefers-color-scheme default.
export function resolvePalette(theme: string, system: string | null | undefined): PaletteId {
  if (theme in PALETTES) return theme as PaletteId;
  return system === 'light' ? 'daylight' : 'midnight';
}

export function usePalette(theme: string) {
  const system = useSystemScheme();
  const id = resolvePalette(theme, system);
  return { id, ...PALETTES[id] };
}

function navTheme(p: (typeof PALETTES)[PaletteId]): Theme {
  const base = p.scheme === 'light' ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: p.hex.bg,
      card: p.hex.surface,
      border: p.hex.border,
      text: p.hex.text,
      primary: p.hex.accent,
      notification: p.hex.bad,
    },
  };
}

export function ThemeRoot({ theme, children }: { theme: string; children: React.ReactNode }) {
  const palette = usePalette(theme);
  const { setColorScheme } = useColorScheme();
  React.useEffect(() => setColorScheme(palette.scheme), [palette.scheme, setColorScheme]);
  const style = React.useMemo(() => [{ flex: 1, backgroundColor: palette.hex.bg }, vars(palette.vars)], [palette]);
  return (
    <ThemeProvider value={navTheme(palette)}>
      <StatusBar style={palette.scheme === 'light' ? 'dark' : 'light'} />
      <View style={style}>{children}</View>
    </ThemeProvider>
  );
}
