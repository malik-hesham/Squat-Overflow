// App-level building blocks on top of the React Native Reusables primitives.
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

// A selectable pill for multi- or single-choice lists that wrap (areas,
// workdays, interval presets): the extension's .chips.
export function Chip({
  selected,
  onPress,
  label,
  hint,
  className,
  disabled,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  hint?: string;
  className?: string;
  disabled?: boolean;
}) {
  // A Pressable rather than Reusables' Toggle: Toggle forwards its className to
  // the label text too, which draws a second pill inside the chip.
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'border-input active:bg-accent min-h-10 justify-center rounded-full border px-3.5 py-2',
        hint && 'rounded-xl',
        selected && 'border-primary bg-primary/15',
        disabled && 'opacity-50',
        className,
      )}>
      <Text className={cn('text-sm font-medium', selected ? 'text-primary' : 'text-foreground')}>{label}</Text>
      {hint ? <Text className="text-muted-foreground mt-0.5 text-xs">{hint}</Text> : null}
    </Pressable>
  );
}

export function ChipRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <View className={cn('flex-row flex-wrap gap-2', className)}>{children}</View>;
}

export function Section({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-3 py-4', className)}>
      {title ? (
        <CardHeader className="flex-row items-center justify-between px-4">
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">{title}</CardTitle>
          {right}
        </CardHeader>
      ) : null}
      <CardContent className="gap-3 px-4">{children}</CardContent>
    </Card>
  );
}

export function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Label nativeID={id} onPress={() => onChange(!checked)} className="leading-5">
          {label}
        </Label>
      </View>
      <Switch nativeID={id} checked={checked} onCheckedChange={onChange} />
    </View>
  );
}

export function Bar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'gold' }) {
  return (
    <Progress
      value={Math.max(0, Math.min(100, value * 100))}
      className={cn('bg-secondary h-2', className)}
      indicatorClassName={tone === 'gold' ? 'bg-gold' : 'bg-primary'}
    />
  );
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Text className={cn('text-muted-foreground text-sm', className)}>{children}</Text>;
}
