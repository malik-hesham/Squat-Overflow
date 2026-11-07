// The extension's pure modules, shared as-is. Only modules with no chrome.* or
// DOM access at import time belong here (store.js, calendar-client.js,
// pose-client.js and themes.js's init stay extension-only).
import './polyfills';

export { LEVELS, XP, levelFor, dayKey, isoWeek, isoWeekNumber, breakXp, award } from '../../../extension/lib/xp.js';
export {
  SNOOZE_MIN,
  SNOOZE_CAP,
  WARN_SKIPS,
  PAUSE_MIN,
  initialSchedule,
  onFire,
  canSnooze,
  showWarning,
  warningHours,
  applyAction,
  upcoming,
  rescheduleForInterval,
  isActive,
  nextActiveSlot,
  scheduleSettingsChanged,
  weekOrder,
} from '../../../extension/lib/schedule.js';
export {
  AREAS,
  BREAK_REPS,
  currentAreas,
  featuredArea,
  buildRoutine,
  swapMove,
  needsPositioning,
  nextOpenMove,
} from '../../../extension/lib/routine.js';
export { DAILY_POOL, WEEKLY, withPeriods, noteAction } from '../../../extension/lib/challenges.js';
export { recordActivity, backfillActivity, heatmapWeeks, activityTotals } from '../../../extension/lib/activity.js';
export { avatarFitness, fitnessCaption } from '../../../extension/lib/fitness.js';
export { badgeLabel, challengeIcon } from '../../../extension/lib/badges.js';
export { submitScore, fetchBoard } from '../../../extension/lib/leaderboard.js';
export { busyNow, agenda } from '../../../extension/lib/calendar.js';
export { MEMES, takeTurn, repMarks, createMemePlayer } from '../../../extension/lib/memes.js';
export { createSerial } from '../../../extension/lib/serial.js';
export { THEMES, themeId } from '../../../extension/lib/themes.js';
export {
  LANGS,
  resolveLang,
  t,
  nameText,
  exerciseText,
  areaName,
  levelName,
  issueText,
  localeFor,
} from '../../../extension/lib/i18n.js';
