import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { localeFor, t } from '@/src/core/i18n';
import { activityTotals, heatmapWeeks } from '@/src/core/shared';
import type { Activity } from '@/src/core/store';
import { cn } from '@/lib/utils';

const WEEKS = 20;
const LEVEL_CLASS = ['bg-secondary', 'bg-primary/30', 'bg-primary/55', 'bg-primary/80', 'bg-primary'];

type Cell = { day: string; at: number; breaks: number; xp: number; level: number; future: boolean; offday: boolean };

// The popup's activity grid: one column per week (Mon..Sun), darker = more breaks.
export function Heatmap({ activity, workdays, lang, now }: { activity: Activity; workdays: number[]; lang: string; now: number }) {
  const weeks = heatmapWeeks(activity, now, WEEKS, workdays) as Cell[][];
  const totals = activityTotals(activity, now, WEEKS);
  const month = (at: number) => new Date(at).toLocaleDateString(localeFor(lang), { month: 'short' });
  const months = weeks.map((w, i) => {
    const m = new Date(w[0].at).getMonth();
    const changed =
      i === 0 ? weeks.slice(1, 3).every((x) => new Date(x[0].at).getMonth() === m) : new Date(weeks[i - 1][0].at).getMonth() !== m;
    return changed ? month(w[0].at) : '';
  });
  return (
    <View className="gap-2">
      <Text className="text-muted-foreground text-xs">{t(lang, 'activityTotal', { breaks: totals.breaks, days: totals.activeDays })}</Text>
      <View className="flex-row gap-[3px]" style={{ direction: 'ltr' }}>
        {weeks.map((w, i) => (
          <View key={w[0].day} className="flex-1 gap-[3px]">
            <Text numberOfLines={1} className="text-muted-foreground h-3 text-[9px]" style={{ width: 40 }}>
              {months[i]}
            </Text>
            {w.map((c) => (
              <View
                key={c.day}
                accessibilityLabel={t(lang, c.breaks === 1 ? 'cellTipOne' : 'cellTip', { date: c.day, n: c.breaks, xp: c.xp })}
                className={cn('aspect-square rounded-[3px]', LEVEL_CLASS[c.level], c.offday && c.level === 0 && 'opacity-50', c.future && 'opacity-0')}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center justify-end gap-1">
        <Text className="text-muted-foreground text-[10px]">{t(lang, 'less')}</Text>
        {LEVEL_CLASS.map((c) => (
          <View key={c} className={cn('size-2.5 rounded-[2px]', c)} />
        ))}
        <Text className="text-muted-foreground text-[10px]">{t(lang, 'more')}</Text>
      </View>
    </View>
  );
}
