//! `chrome.alarms` for the desktop app. Alarms are compared with the wall clock on every tick
//! (lib.rs), so one that came due while the computer slept fires right after it wakes, late, as
//! Chrome's do. extension/lib/schedule.js's decideFire() already handles a late alarm.

use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};

const MINUTE_MS: f64 = 60_000.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Alarm {
    pub name: String,
    /// Milliseconds since the epoch, like `Date.now()`.
    pub scheduled_time: f64,
    pub period_in_minutes: Option<f64>,
}

impl Alarm {
    pub fn to_json(&self) -> Value {
        let mut alarm = json!({ "name": self.name, "scheduledTime": self.scheduled_time });
        if let Some(period) = self.period_in_minutes {
            alarm["periodInMinutes"] = json!(period);
        }
        alarm
    }
}

#[derive(Default)]
pub struct Alarms(Mutex<HashMap<String, Alarm>>);

impl Alarms {
    /// Creates the alarm, replacing one with the same name. It first fires at `when`, else after
    /// `delay_in_minutes`, else after one period.
    pub fn create(&self, name: String, now: f64, when: Option<f64>, delay_in_minutes: Option<f64>, period_in_minutes: Option<f64>) {
        let scheduled_time = when.unwrap_or_else(|| now + delay_in_minutes.or(period_in_minutes).unwrap_or(0.0) * MINUTE_MS);
        self.0.lock().unwrap().insert(name.clone(), Alarm { name, scheduled_time, period_in_minutes });
    }

    pub fn get(&self, name: &str) -> Option<Alarm> {
        self.0.lock().unwrap().get(name).cloned()
    }

    pub fn clear(&self, name: &str) -> bool {
        self.0.lock().unwrap().remove(name).is_some()
    }

    /// The alarms due at `now`, earliest first. A one-shot alarm is removed; a repeating one is set
    /// to fire one period after `now`, so a long sleep gives one late alarm and not a burst.
    pub fn take_due(&self, now: f64) -> Vec<Alarm> {
        let mut alarms = self.0.lock().unwrap();
        let mut due: Vec<Alarm> = alarms.values().filter(|a| a.scheduled_time <= now).cloned().collect();
        due.sort_by(|a, b| a.scheduled_time.total_cmp(&b.scheduled_time));
        for alarm in &due {
            match alarm.period_in_minutes {
                Some(period) => alarms.get_mut(&alarm.name).unwrap().scheduled_time = now + period * MINUTE_MS,
                None => {
                    alarms.remove(&alarm.name);
                }
            }
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(alarms: &[Alarm]) -> Vec<&str> {
        alarms.iter().map(|a| a.name.as_str()).collect()
    }

    #[test]
    fn a_one_shot_alarm_fires_once_at_its_time() {
        let alarms = Alarms::default();
        alarms.create("next-break".into(), 1_000.0, Some(61_000.0), None, None);

        assert!(alarms.take_due(60_999.0).is_empty());
        assert_eq!(names(&alarms.take_due(61_000.0)), ["next-break"]);
        assert!(alarms.take_due(200_000.0).is_empty());
        assert_eq!(alarms.get("next-break"), None);
    }

    #[test]
    fn a_repeating_alarm_first_fires_after_one_period_and_fires_once_after_a_long_sleep() {
        let alarms = Alarms::default();
        alarms.create("badge-tick".into(), 0.0, None, None, Some(1.0));
        assert_eq!(alarms.get("badge-tick").unwrap().scheduled_time, 60_000.0);

        // Eight hours asleep: one alarm, and the next one a minute after waking.
        let woke = 8.0 * 60.0 * MINUTE_MS;
        assert_eq!(names(&alarms.take_due(woke)), ["badge-tick"]);
        assert!(alarms.take_due(woke + 59_999.0).is_empty());
        assert_eq!(names(&alarms.take_due(woke + 60_000.0)), ["badge-tick"]);
    }

    #[test]
    fn creating_an_alarm_again_replaces_it_and_due_alarms_come_earliest_first() {
        let alarms = Alarms::default();
        alarms.create("next-break".into(), 0.0, Some(10_000.0), None, None);
        alarms.create("next-break".into(), 0.0, Some(50_000.0), None, None);
        alarms.create("countdown".into(), 0.0, Some(20_000.0), None, None);

        assert_eq!(names(&alarms.take_due(30_000.0)), ["countdown"]);
        alarms.create("sync".into(), 30_000.0, None, Some(0.25), None);
        assert_eq!(names(&alarms.take_due(60_000.0)), ["sync", "next-break"]);
        assert!(alarms.clear("missing") == false);
    }

    #[test]
    fn to_json_matches_chromes_alarm_object() {
        let alarms = Alarms::default();
        alarms.create("sync".into(), 0.0, None, None, Some(1.0));
        assert_eq!(alarms.get("sync").unwrap().to_json(), json!({ "name": "sync", "scheduledTime": 60_000.0, "periodInMinutes": 1.0 }));
    }
}
