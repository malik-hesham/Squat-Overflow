import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Bar } from '@/src/components/kit';
import { areaName, nameText, t } from '@/src/core/i18n';
import { DAILY_POOL, WEEKLY, badgeLabel, challengeIcon } from '@/src/core/shared';
import type { Profile } from '@/src/core/store';
import { cn } from '@/lib/utils';

type Daily = NonNullable<Profile['daily']>;

function progress(lang: string, id: string, d: Daily): [number, number, string] {
  const table: Record<string, [number, number, string]> = {
    variety: [d.areas.length, 3, t(lang, 'unitAreas')],
    high_five: [d.breaks, 5, t(lang, 'unitBreaks')],
    clean_form: [d.done.includes(id) ? 1 : 0, 1, t(lang, 'unitCleanForm')],
    early_mover: [d.done.includes(id) ? 1 : 0, 1, t(lang, 'unitEarly')],
    no_excuses: [d.run, 3, t(lang, 'unitNoSkips')],
  };
  return table[id];
}

function Tile({ id, name, bonus, have, need, unit, done, wide }: { id: string; name: string; bonus: number; have: number; need: number; unit: string; done: boolean; wide?: boolean }) {
  const shown = Math.min(have, need);
  return (
    <View
      accessibilityLabel={`${name} · ${shown}/${need} ${unit} · +${bonus}`}
      className={cn('border-border gap-1.5 rounded-xl border p-3', wide ? 'w-full' : 'w-[48.5%]', done && 'border-primary bg-primary/10')}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl">{challengeIcon(id)}</Text>
        {done ? <Text className="text-primary font-bold">✓</Text> : null}
      </View>
      <Text numberOfLines={2} className="text-sm font-medium">
        {name}
      </Text>
      <Bar value={have / need} />
      <View className="flex-row justify-between">
        <Text className="text-muted-foreground text-xs">
          {shown}/{need}
        </Text>
        <Text className="text-gold text-xs font-bold">+{bonus}</Text>
      </View>
    </View>
  );
}

// Today's challenges, this week's featured area and the badge shelf.
export function Challenges({ profile, lang }: { profile: Profile; lang: string }) {
  const d = profile.daily!;
  const w = profile.weekly!;
  const area = areaName(lang, w.area);
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap justify-between gap-y-2">
        {d.ids.map((id) => {
          const c = DAILY_POOL.find((x: { id: string }) => x.id === id)!;
          const [have, need, unit] = progress(lang, id, d);
          return <Tile key={id} id={id} name={nameText(lang, `challenge.${id}`, c.name)} bonus={c.bonus} have={have} need={need} unit={unit} done={d.done.includes(id)} />;
        })}
        <Tile
          id="weekly"
          wide
          name={t(lang, 'areaWeek', { area })}
          bonus={WEEKLY.bonus}
          have={w.count}
          need={WEEKLY.target}
          unit={t(lang, 'unitAreaExercises', { area })}
          done={w.done}
        />
      </View>
      {profile.badges.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {profile.badges.map((id) => (
            <View key={id} className="bg-secondary rounded-full px-2.5 py-1">
              <Text className="text-xs">{badgeLabel(id, lang)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
