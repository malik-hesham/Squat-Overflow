//! `chrome.storage.local` for the desktop app: one JSON file with the extension's own keys
//! (extension/lib/store.js), like the Mac app's store.json.

use serde_json::{json, Map, Value};
use std::{fs, io, path::PathBuf, sync::Mutex};

pub struct Store {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
    /// No store file yet: the extension's "install".
    pub first_run: bool,
}

impl Store {
    /// A file that can't be read as a JSON object is kept under another name, never overwritten:
    /// it holds the user's XP and streak.
    pub fn open(path: PathBuf) -> Self {
        let (data, first_run) = match fs::read(&path) {
            Err(_) => (Map::new(), true),
            Ok(bytes) => match serde_json::from_slice::<Map<String, Value>>(&bytes) {
                Ok(data) => (data, false),
                Err(err) => {
                    let kept = path.with_extension("json.unreadable");
                    eprintln!("store: {} is not a JSON object ({err}); kept as {}", path.display(), kept.display());
                    let _ = fs::rename(&path, &kept);
                    (Map::new(), true)
                }
            },
        };
        Self { path, data: Mutex::new(data), first_run }
    }

    /// The stored values of `keys`, or everything for `None`. Missing keys are left out.
    pub fn get(&self, keys: Option<&[String]>) -> Map<String, Value> {
        let data = self.data.lock().unwrap();
        match keys {
            None => data.clone(),
            Some(keys) => keys.iter().filter_map(|k| data.get(k).map(|v| (k.clone(), v.clone()))).collect(),
        }
    }

    /// Stores `items` and returns what changed, in the shape of `chrome.storage.onChanged`:
    /// `{ key: { oldValue?, newValue } }`. A key set to the value it already has isn't a change.
    pub fn set(&self, items: Map<String, Value>) -> io::Result<Map<String, Value>> {
        let mut data = self.data.lock().unwrap();
        let mut changes = Map::new();
        for (key, value) in items {
            let old = data.get(&key);
            if old == Some(&value) {
                continue;
            }
            let mut change = Map::new();
            if let Some(old) = old {
                change.insert("oldValue".into(), old.clone());
            }
            change.insert("newValue".into(), value.clone());
            changes.insert(key.clone(), Value::Object(change));
            data.insert(key, value);
        }
        if !changes.is_empty() {
            self.write(&data)?;
        }
        Ok(changes)
    }

    pub fn remove(&self, keys: &[String]) -> io::Result<Map<String, Value>> {
        let mut data = self.data.lock().unwrap();
        let mut changes = Map::new();
        for key in keys {
            if let Some(old) = data.remove(key) {
                changes.insert(key.clone(), json!({ "oldValue": old }));
            }
        }
        if !changes.is_empty() {
            self.write(&data)?;
        }
        Ok(changes)
    }

    /// Writes a new file and renames it over the old one, so a crash can't leave half a store.
    fn write(&self, data: &Map<String, Value>) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(data)?)?;
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("so-desktop-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("store.json")
    }

    fn items(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn set_reports_only_real_changes_and_persists() {
        let path = temp_store("set");
        let store = Store::open(path.clone());
        assert!(store.first_run);

        let changes = store.set(items(json!({ "intervalMin": 60, "areas": ["neck"] }))).unwrap();
        assert_eq!(Value::Object(changes), json!({ "intervalMin": { "newValue": 60 }, "areas": { "newValue": ["neck"] } }));

        let changes = store.set(items(json!({ "intervalMin": 45, "areas": ["neck"] }))).unwrap();
        assert_eq!(Value::Object(changes), json!({ "intervalMin": { "oldValue": 60, "newValue": 45 } }));

        let reopened = Store::open(path);
        assert!(!reopened.first_run);
        assert_eq!(Value::Object(reopened.get(None)), json!({ "intervalMin": 45, "areas": ["neck"] }));
    }

    #[test]
    fn get_leaves_out_missing_keys_and_remove_reports_old_values() {
        let store = Store::open(temp_store("get"));
        store.set(items(json!({ "theme": "auto", "lang": "ar" }))).unwrap();

        let found = store.get(Some(&["lang".to_string(), "serverUrl".to_string()]));
        assert_eq!(Value::Object(found), json!({ "lang": "ar" }));

        let changes = store.remove(&["lang".to_string(), "serverUrl".to_string()]).unwrap();
        assert_eq!(Value::Object(changes), json!({ "lang": { "oldValue": "ar" } }));
        assert_eq!(Value::Object(store.get(None)), json!({ "theme": "auto" }));
    }

    #[test]
    fn an_unreadable_file_is_kept_not_overwritten() {
        let path = temp_store("unreadable");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{ not json").unwrap();

        let store = Store::open(path.clone());
        assert!(store.first_run);
        store.set(items(json!({ "theme": "dark" }))).unwrap();
        assert_eq!(fs::read(path.with_extension("json.unreadable")).unwrap(), b"{ not json");
    }
}
