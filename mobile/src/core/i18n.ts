// Strings come from the extension (extension/lib/i18n.js). The few that only
// make sense on a phone, or read differently here, are added or overridden below.
import { t as sharedT } from './shared';

const EN: Record<string, string> = {
  breakReminders: 'Break reminders',
  startBreak: 'Start break',
  reminderBody: '2-minute break: {areas}',
  reminderAnyArea: 'a quick stretch',
  reminderWarnBody: "You've skipped your last few breaks. Two minutes now makes a real difference.",
  breakDue: 'Your break is due',
  breakDueBody: 'Two minutes, then back to it.',
  framesLocal: 'Frames stay on this phone.',
  autoPause: "Don't interrupt calendar meetings",
  calendar: 'Calendar',
  calConnect: 'Use my calendar',
  calDisconnect: 'Stop using calendar',
  calNote: 'Breaks wait until your meetings end. Only busy and free times are read from your phone’s calendars, never event titles or details.',
  calDenied: 'Calendar access is off. Turn it on in your phone settings.',
  notificationsOff: 'Notifications are off, so reminders can’t reach you.',
  openSettings: 'Open settings',
  restartTitle: 'Restart to switch direction',
  restartBody: 'Close and reopen the app to switch between left-to-right and right-to-left.',
  ok: 'OK',
  watchDemo: 'Watch demo',
  hideDemo: 'Hide demo',
  pickAvatar: 'Pick a buddy for the leaderboard.',
  practiceSoon: 'Practice mode is coming to the app soon.',
  leaveBreakTitle: 'Leave this break?',
  leaveBreakBody: 'Leaving without Done, Snooze or Skip counts as a skip.',
  leave: 'Leave',
  stay: 'Stay',
  testReminder: 'Send a test reminder',
  back: 'Back',
  privacy: 'Hide me in the camera preview (show only my skeleton)',
  lookSkeleton: 'Skeleton',
  simulated: 'No camera here: a simulated coach is counting reps (development build).',
};

const AR: Record<string, string> = {
  breakReminders: 'تذكيرات الاستراحة',
  startBreak: 'ابدأ الاستراحة',
  reminderBody: 'استراحة دقيقتين: {areas}',
  reminderAnyArea: 'تمدد سريع',
  reminderWarnBody: 'تخطيت آخر استراحاتك. دقيقتان الآن تصنعان فرقًا حقيقيًا.',
  breakDue: 'حان وقت استراحتك',
  breakDueBody: 'دقيقتان، ثم عُد لعملك.',
  framesLocal: 'الصور تبقى على هذا الهاتف.',
  autoPause: 'لا تقاطع اجتماعات التقويم',
  calendar: 'التقويم',
  calConnect: 'استخدم تقويمي',
  calDisconnect: 'أوقف استخدام التقويم',
  calNote: 'تنتظر الاستراحات حتى تنتهي اجتماعاتك. تُقرأ أوقات الانشغال والفراغ فقط من تقاويم هاتفك، وليس عناوين الأحداث أو تفاصيلها.',
  calDenied: 'الوصول إلى التقويم مغلق. فعّله من إعدادات الهاتف.',
  notificationsOff: 'الإشعارات مغلقة، لذا لن تصلك التذكيرات.',
  openSettings: 'افتح الإعدادات',
  restartTitle: 'أعد التشغيل لتغيير الاتجاه',
  restartBody: 'أغلق التطبيق وافتحه مجددًا للتبديل بين الكتابة من اليسار ومن اليمين.',
  ok: 'حسنًا',
  watchDemo: 'شاهد الشرح',
  hideDemo: 'إخفاء الشرح',
  pickAvatar: 'اختر رفيقًا لقائمة المتصدرين.',
  practiceSoon: 'وضع التدريب قادم إلى التطبيق قريبًا.',
  leaveBreakTitle: 'هل تغادر هذه الاستراحة؟',
  leaveBreakBody: 'المغادرة دون تم أو تأجيل أو تخطٍ تُحسب تخطيًا.',
  leave: 'غادر',
  stay: 'ابقَ',
  testReminder: 'أرسل تذكيرًا تجريبيًا',
  back: 'رجوع',
  privacy: 'أخفني في معاينة الكاميرا (أظهر هيكلي فقط)',
  lookSkeleton: 'الهيكل',
  simulated: 'لا توجد كاميرا هنا: مدرب تجريبي يعدّ التكرارات (نسخة تطوير).',
};

export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const text = (lang === 'ar' ? AR[key] : undefined) ?? EN[key];
  if (text === undefined) return sharedT(lang, key, vars);
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export { areaName, exerciseText, issueText, levelName, localeFor, nameText, resolveLang } from './shared';
