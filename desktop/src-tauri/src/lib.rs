//! The Rust shell of the desktop app. It owns what the browser owns for the extension: the status
//! bar icon (the toolbar button), the windows, storage, alarms and the idle time. Everything the
//! user sees and every rule is the extension's own code, loaded from desktop/web/ and talking to
//! this shell through shim/chrome-shim.js. One command here backs one `chrome.*` call there.

mod alarms;
mod store;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    webview::{PermissionKind, PermissionResponse},
    AppHandle, LogicalSize, Manager, PhysicalPosition, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};

const SHIM: &str = include_str!("../../shim/chrome-shim.js");
const APP_NAME: &str = "Squat Overflow";
const BACKGROUND: &str = "background";
/// Window ids as the pages see them (`chrome.windows`); a window's label is `w<id>`.
const POPUP_ID: u64 = 1;
const OPTIONS_ID: u64 = 2;
const FIRST_WINDOW_ID: u64 = 10;
/// popup.css's body width, and the height range the popup may take. Chrome stops a popup at 600
/// and the page scrolls from there.
const POPUP_WIDTH: f64 = 360.0;
const POPUP_HEIGHTS: (f64, f64) = (160.0, 600.0);
const OPTIONS_SIZE: (f64, f64) = (760.0, 820.0);
const DEFAULT_SIZE: (f64, f64) = (980.0, 760.0);
const CAMERA_PAGES: [&str; 2] = ["/break.html", "/trainer.html"];
/// How long a page waits for service-worker.js to answer a message.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);
const ALARM_TICK: Duration = Duration::from_millis(500);

struct TrayUi {
    icon: TrayIcon,
    status: MenuItem<Wry>,
    break_now: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    settings: MenuItem<Wry>,
}

/// Where the popup hangs from the status bar icon, in physical pixels.
#[derive(Clone, Copy, Debug)]
struct Anchor {
    /// The popup's top edge (icon at the top of the screen) or bottom edge (icon at the bottom).
    edge_y: f64,
    below: bool,
    scale: f64,
}

struct Shell {
    store: store::Store,
    alarms: alarms::Alarms,
    /// Pages waiting for service-worker.js to answer a `chrome.runtime.sendMessage`.
    replies: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>,
    next_message: AtomicU64,
    next_window: AtomicU64,
    tray: Mutex<Option<TrayUi>>,
    paused: AtomicBool,
    popup_anchor: Mutex<Option<Anchor>>,
    popup_closed: Mutex<Option<Instant>>,
    trace: bool,
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

fn label_of(id: u64) -> String {
    format!("w{id}")
}

fn id_of(label: &str) -> Option<u64> {
    label.strip_prefix('w')?.parse().ok()
}

/// Sends a shell event to one page (chrome-shim.js's `dispatch`).
fn dispatch(window: &WebviewWindow, name: &str, payload: &Value) {
    let _ = window.eval(format!("window.__soShim && window.__soShim.dispatch({}, {payload})", json!(name)));
}

fn dispatch_to_background(app: &AppHandle, name: &str, payload: &Value) {
    if let Some(background) = app.get_webview_window(BACKGROUND) {
        dispatch(&background, name, payload);
    }
}

/// Opens one of the app's own pages (a path inside desktop/web/, never a web address).
fn build_window<'a>(app: &'a AppHandle, label: &str, page: &str) -> Result<WebviewWindowBuilder<'a, Wry, AppHandle>, String> {
    if page.contains("://") || page.starts_with('/') {
        return Err(format!("not a page of this app: {page}"));
    }
    let shell = app.state::<Shell>();
    let script = if shell.trace { format!("window.__SO_TRACE__ = true;\n{SHIM}") } else { SHIM.to_string() };
    let builder = WebviewWindowBuilder::new(app, label.to_string(), WebviewUrl::App(PathBuf::from(page)))
        .title(APP_NAME)
        .initialization_script(script)
        .on_permission_request(|webview, kind| match kind {
            PermissionKind::Camera if uses_camera(&webview) => PermissionResponse::Allow,
            _ => PermissionResponse::Deny,
        });
    Ok(builder)
}

/// The camera is for the break and Practice pages, the two that use it in the extension, and for
/// nothing else: no other page, and no microphone, location or notifications anywhere. macOS
/// still asks the user itself the first time (NSCameraUsageDescription in Info.plist).
fn uses_camera(webview: &tauri::Webview) -> bool {
    webview.url().is_ok_and(|url| CAMERA_PAGES.contains(&url.path()))
}

fn window_info(id: u64, window: &WebviewWindow) -> Value {
    let state = if window.is_fullscreen().unwrap_or(false) {
        "fullscreen"
    } else if window.is_minimized().unwrap_or(false) {
        "minimized"
    } else {
        "normal"
    };
    let url = window.url().map(|u| u.to_string()).unwrap_or_default();
    json!({
        "id": id,
        "state": state,
        "focused": window.is_focused().unwrap_or(false),
        "tabs": [{ "id": id, "windowId": id, "url": url }],
    })
}

fn find_window(app: &AppHandle, id: u64) -> Result<WebviewWindow, String> {
    app.get_webview_window(&label_of(id)).ok_or_else(|| format!("No window with id: {id}."))
}

fn broadcast_changes(app: &AppHandle, changes: Map<String, Value>) {
    if changes.is_empty() {
        return;
    }
    let changes = Value::Object(changes);
    for window in app.webview_windows().values() {
        dispatch(window, "storage.changed", &changes);
    }
}

/// Delivers a message to service-worker.js and waits for its answer, like `chrome.runtime.sendMessage`.
async fn send_to_background(app: AppHandle, message: Value) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let id = {
        let shell = app.state::<Shell>();
        let id = shell.next_message.fetch_add(1, Ordering::Relaxed);
        shell.replies.lock().unwrap().insert(id, tx);
        id
    };
    dispatch_to_background(&app, "runtime.message", &json!({ "id": id, "message": message }));
    let answer = tokio::time::timeout(REPLY_TIMEOUT, rx).await;
    app.state::<Shell>().replies.lock().unwrap().remove(&id);
    match answer {
        Ok(Ok(response)) => Ok(response),
        _ => Err("Could not establish connection. Receiving end does not exist.".into()),
    }
}

/// A tray menu item that does what the popup's button does: the same message to service-worker.js.
fn post_to_background(app: &AppHandle, kind: &str) {
    let app = app.clone();
    let message = json!({ "type": kind });
    tauri::async_runtime::spawn(async move {
        if let Err(err) = send_to_background(app, message).await {
            eprintln!("menu: {err}");
        }
    });
}

// ---- chrome.storage.local -------------------------------------------------------------------

#[tauri::command]
fn storage_get(shell: State<Shell>, keys: Option<Vec<String>>) -> Map<String, Value> {
    shell.store.get(keys.as_deref())
}

#[tauri::command]
fn storage_set(app: AppHandle, shell: State<Shell>, items: Map<String, Value>) -> Result<(), String> {
    let changes = shell.store.set(items).map_err(|e| e.to_string())?;
    broadcast_changes(&app, changes);
    Ok(())
}

#[tauri::command]
fn storage_remove(app: AppHandle, shell: State<Shell>, keys: Vec<String>) -> Result<(), String> {
    let changes = shell.store.remove(&keys).map_err(|e| e.to_string())?;
    broadcast_changes(&app, changes);
    Ok(())
}

// ---- chrome.alarms --------------------------------------------------------------------------

#[tauri::command]
fn alarms_create(shell: State<Shell>, name: String, when: Option<f64>, delay_in_minutes: Option<f64>, period_in_minutes: Option<f64>) {
    shell.alarms.create(name, now_ms(), when, delay_in_minutes, period_in_minutes);
}

#[tauri::command]
fn alarms_get(shell: State<Shell>, name: String) -> Option<Value> {
    shell.alarms.get(&name).map(|alarm| alarm.to_json())
}

#[tauri::command]
fn alarms_clear(shell: State<Shell>, name: String) -> bool {
    shell.alarms.clear(&name)
}

// ---- chrome.runtime -------------------------------------------------------------------------

#[tauri::command]
async fn runtime_send_message(app: AppHandle, message: Value) -> Result<Value, String> {
    send_to_background(app, message).await
}

#[tauri::command]
fn runtime_reply(shell: State<Shell>, id: u64, response: Value) {
    if let Some(waiting) = shell.replies.lock().unwrap().remove(&id) {
        let _ = waiting.send(response);
    }
}

#[tauri::command]
fn startup_info(shell: State<Shell>) -> Value {
    json!({ "firstRun": shell.store.first_run })
}

#[tauri::command]
async fn open_options(app: AppHandle) -> Result<(), String> {
    show_options(&app)
}

fn show_options(app: &AppHandle) -> Result<(), String> {
    if let Some(open) = app.get_webview_window(&label_of(OPTIONS_ID)) {
        return open.set_focus().map_err(|e| e.to_string());
    }
    let window = build_window(app, &label_of(OPTIONS_ID), "options.html")?
        .inner_size(OPTIONS_SIZE.0, OPTIONS_SIZE.1)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

// ---- chrome.action: the status bar icon ------------------------------------------------------

/// The badge is the countdown ("23m", "45s", "move"). macOS shows it next to the icon, and so do
/// the Linux desktops whose tray has labels. Windows can't, so there it is in the tooltip and the
/// menu's first line (action_set_title).
#[tauri::command]
fn action_set_badge(shell: State<Shell>, text: String) {
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        let _ = tray.icon.set_title(if text.is_empty() { None } else { Some(text.as_str()) });
    }
}

#[tauri::command]
fn action_set_title(shell: State<Shell>, title: String) {
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        let text = if title.is_empty() { APP_NAME } else { title.as_str() };
        let _ = tray.icon.set_tooltip(Some(text));
        let _ = tray.status.set_text(text);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MenuLabels {
    break_now: String,
    pause: String,
    settings: String,
    paused: bool,
}

/// The menu's labels, from the extension's strings (shim/background.js).
#[tauri::command]
fn set_menu(shell: State<Shell>, labels: MenuLabels) {
    shell.paused.store(labels.paused, Ordering::Relaxed);
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        let _ = tray.break_now.set_text(&labels.break_now);
        let _ = tray.pause.set_text(&labels.pause);
        let _ = tray.settings.set_text(&labels.settings);
    }
}

// ---- chrome.windows -------------------------------------------------------------------------

#[tauri::command]
async fn windows_create(app: AppHandle, url: String, width: Option<f64>, height: Option<f64>, focused: bool) -> Result<Value, String> {
    let page = page_of(&app, &url)?;
    let id = app.state::<Shell>().next_window.fetch_add(1, Ordering::Relaxed);
    let window = build_window(&app, &label_of(id), &page)?
        .inner_size(width.unwrap_or(DEFAULT_SIZE.0), height.unwrap_or(DEFAULT_SIZE.1))
        .center()
        .focused(focused)
        .build()
        .map_err(|e| e.to_string())?;
    if focused {
        let _ = window.set_focus();
    }
    Ok(window_info(id, &window))
}

/// `chrome.runtime.getURL()` gives pages a full address; this takes it back to the path in web/.
fn page_of(app: &AppHandle, url: &str) -> Result<String, String> {
    let background = app.get_webview_window(BACKGROUND).ok_or("the background page is gone")?;
    let base = background.url().map_err(|e| e.to_string())?;
    resolve_page(&base, url)
}

/// The path in web/ of `url`, which must be a page of this app: `base` (the background page's
/// address) is one.
fn resolve_page(base: &tauri::Url, url: &str) -> Result<String, String> {
    let target = base.join(url).map_err(|e| e.to_string())?;
    if origin_of(&target) != origin_of(base) {
        return Err(format!("not a page of this app: {url}"));
    }
    let mut page = target.path().trim_start_matches('/').to_string();
    if let Some(query) = target.query() {
        page = format!("{page}?{query}");
    }
    if let Some(fragment) = target.fragment() {
        page = format!("{page}#{fragment}");
    }
    Ok(page)
}

/// Scheme, host and port. Not `Url::origin()`: for the tauri:// scheme the pages load from on
/// macOS and Linux it is opaque, and no two opaque origins are equal, so no page would match.
fn origin_of(url: &tauri::Url) -> (&str, Option<&str>, Option<u16>) {
    (url.scheme(), url.host_str(), url.port_or_known_default())
}

#[tauri::command]
fn windows_get(app: AppHandle, id: u64) -> Result<Value, String> {
    Ok(window_info(id, &find_window(&app, id)?))
}

/// Only this app's windows. `chrome.windows.getAll()` lists the browser's, which service-worker.js
/// checks for a fullscreen one before a reminder: README, "Gaps".
#[tauri::command]
fn windows_get_all(app: AppHandle) -> Vec<Value> {
    app.webview_windows().iter().filter_map(|(label, window)| Some(window_info(id_of(label)?, window))).collect()
}

#[tauri::command]
fn windows_current(window: WebviewWindow) -> Result<Value, String> {
    let id = id_of(window.label()).ok_or("the background page has no window id")?;
    Ok(window_info(id, &window))
}

#[tauri::command]
fn windows_update(app: AppHandle, id: u64, focused: Option<bool>) -> Result<Value, String> {
    let window = find_window(&app, id)?;
    if focused == Some(true) {
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(window_info(id, &window))
}

#[tauri::command]
fn windows_remove(app: AppHandle, id: u64) -> Result<(), String> {
    find_window(&app, id)?.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_close(window: WebviewWindow) {
    let _ = window.close();
}

// ---- The rest: web links, idle time, the popup's height, page logs ---------------------------

/// Opens a page on the web in the user's browser. Only https, so a page can't start other programs.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("only https links open in the browser: {url}"));
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

/// `chrome.idle.queryState`: "idle" after `seconds` without keyboard or mouse input. A desktop
/// where the idle time can't be read (some Wayland sessions) counts as active.
#[tauri::command]
fn idle_state(seconds: u64) -> &'static str {
    match user_idle::UserIdle::get_time() {
        Ok(idle) if idle.as_seconds() >= seconds => "idle",
        _ => "active",
    }
}

#[tauri::command]
fn popup_fit(window: WebviewWindow, shell: State<Shell>, height: f64) {
    if id_of(window.label()) != Some(POPUP_ID) {
        return;
    }
    let height = height.clamp(POPUP_HEIGHTS.0, POPUP_HEIGHTS.1);
    let _ = window.set_size(LogicalSize::new(POPUP_WIDTH, height));
    // Hanging above an icon at the bottom of the screen: keep the bottom edge where it is.
    if let Some(Anchor { edge_y, below: false, scale }) = *shell.popup_anchor.lock().unwrap() {
        if let Ok(position) = window.outer_position() {
            let _ = window.set_position(PhysicalPosition::new(position.x as f64, edge_y - height * scale));
        }
    }
    if shell.trace {
        eprintln!("[popup] fit: height {height}, at {:?}, anchor {:?}", window.outer_position().ok(), *shell.popup_anchor.lock().unwrap());
    }
}

#[tauri::command]
fn log(window: WebviewWindow, level: String, message: String) {
    eprintln!("[{}] {level}: {message}", window.label());
}

// ---- The popup ------------------------------------------------------------------------------

/// Shows popup.html. With `icon` (a click on the status bar icon, macOS and Windows) it hangs from
/// the icon like the extension's popup and closes when it loses focus. Without (the menu's "Open",
/// the only way on Linux, where the tray reports no clicks) it is a small ordinary window.
fn toggle_popup(app: &AppHandle, icon: Option<tauri::Rect>) -> Result<(), String> {
    let shell = app.state::<Shell>();
    if let Some(open) = app.get_webview_window(&label_of(POPUP_ID)) {
        return open.close().map_err(|e| e.to_string());
    }
    // The click that took the popup's focus (and closed it) isn't a click to open it again.
    if icon.is_some() && shell.popup_closed.lock().unwrap().is_some_and(|at| at.elapsed() < Duration::from_millis(300)) {
        return Ok(());
    }
    let builder = build_window(app, &label_of(POPUP_ID), "popup.html")?
        .inner_size(POPUP_WIDTH, POPUP_HEIGHTS.1)
        .resizable(false)
        .visible(false);
    let Some(icon) = icon else {
        *shell.popup_anchor.lock().unwrap() = None;
        let window = builder.center().build().map_err(|e| e.to_string())?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    };

    if shell.trace {
        let monitors: Vec<_> = app.available_monitors().unwrap_or_default().iter().map(|m| (*m.position(), *m.size(), m.scale_factor())).collect();
        eprintln!("[popup] icon {icon:?}, monitors {monitors:?}");
    }
    let corner = icon.position.to_physical::<f64>(1.0);
    let monitor = app.monitor_from_point(corner.x, corner.y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map_or(1.0, |m| m.scale_factor());
    let size = icon.size.to_physical::<f64>(scale);
    let width = POPUP_WIDTH * scale;
    let (screen_x, screen_y, screen_w, screen_h) = monitor.as_ref().map_or((0.0, 0.0, f64::MAX, f64::MAX), |m| {
        (m.position().x as f64, m.position().y as f64, m.size().width as f64, m.size().height as f64)
    });
    let below = corner.y < screen_y + screen_h / 2.0;
    let edge_y = if below { corner.y + size.height } else { corner.y };
    let x = (corner.x + size.width / 2.0 - width / 2.0).clamp(screen_x, (screen_x + screen_w - width).max(screen_x));
    let y = if below { edge_y } else { edge_y - POPUP_HEIGHTS.1 * scale };
    *shell.popup_anchor.lock().unwrap() = Some(Anchor { edge_y, below, scale });

    let window = builder.decorations(false).always_on_top(true).skip_taskbar(true).build().map_err(|e| e.to_string())?;
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

// ---- The status bar icon and its menu --------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<TrayUi> {
    let status = MenuItem::with_id(app, "status", APP_NAME, false, None::<&str>)?;
    // "Open" and "Quit" have no string in the extension: a browser has neither.
    let open = MenuItem::with_id(app, "open", "Open Squat Overflow", true, None::<&str>)?;
    let break_now = MenuItem::with_id(app, "break-now", "Break now", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause 1 hr", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Squat Overflow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&status, &PredefinedMenuItem::separator(app)?, &open, &break_now, &pause, &settings, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    let icon = TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                off_event_loop(tray.app_handle(), move |app| toggle_popup(app, Some(rect)));
            }
        })
        .build(app)?;
    Ok(TrayUi { icon, status, break_now, pause, settings })
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => off_event_loop(app, |app| toggle_popup(app, None)),
        "settings" => off_event_loop(app, show_options),
        "break-now" => post_to_background(app, "break-now"),
        "pause" => {
            let paused = app.state::<Shell>().paused.load(Ordering::Relaxed);
            post_to_background(app, if paused { "resume" } else { "pause" })
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Runs `work` on another thread. Tray and menu events arrive on the event loop, and building a
/// window from there deadlocks on Windows (WebView2), so windows are built from here.
fn off_event_loop(app: &AppHandle, work: impl FnOnce(&AppHandle) -> Result<(), String> + Send + 'static) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = work(&app) {
            eprintln!("window: {err}");
        }
    });
}

fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let Some(id) = id_of(window.label()) else { return };
    let app = window.app_handle();
    let shell = app.state::<Shell>();
    match event {
        // The popup hanging from the icon goes away when you click elsewhere, like the extension's.
        WindowEvent::Focused(false) if id == POPUP_ID && shell.popup_anchor.lock().unwrap().is_some() => {
            *shell.popup_closed.lock().unwrap() = Some(Instant::now());
            let _ = window.close();
        }
        // chrome.windows.onRemoved: service-worker.js counts a closed reminder as "close".
        WindowEvent::Destroyed => dispatch_to_background(app, "windows.removed", &json!(id)),
        _ => {}
    }
}

/// Debug builds only, for trying the app without a hand on the mouse.
/// SO_DEBUG_MENU=click,pause acts like those menu items, three seconds apart, after launch;
/// "click" is a left click on the status bar icon. SO_DEBUG_EVAL runs a script in the background
/// page, for what the menu can't reach.
#[cfg(debug_assertions)]
fn debug_hooks(app: &AppHandle) {
    let ids = std::env::var("SO_DEBUG_MENU").unwrap_or_default();
    let script = std::env::var("SO_DEBUG_EVAL").ok();
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        if let (Some(script), Some(background)) = (script, app.get_webview_window(BACKGROUND)) {
            let _ = background.eval(script);
        }
        for id in ids.split(',').map(str::trim).filter(|id| !id.is_empty()) {
            let (handle, id) = (app.clone(), id.to_string());
            let _ = app.run_on_main_thread(move || {
                if id != "click" {
                    return on_menu(&handle, &id);
                }
                let icon = handle.state::<Shell>().tray.lock().unwrap().as_ref().and_then(|tray| tray.icon.rect().ok().flatten());
                off_event_loop(&handle, move |app| toggle_popup(app, icon));
            });
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            storage_get,
            storage_set,
            storage_remove,
            alarms_create,
            alarms_get,
            alarms_clear,
            runtime_send_message,
            runtime_reply,
            startup_info,
            open_options,
            action_set_badge,
            action_set_title,
            set_menu,
            windows_create,
            windows_get,
            windows_get_all,
            windows_current,
            windows_update,
            windows_remove,
            window_close,
            open_external,
            idle_state,
            popup_fit,
            log,
        ])
        .on_window_event(on_window_event)
        .setup(|app| {
            // SO_DATA_DIR keeps a test run away from the real store.
            let dir = match std::env::var_os("SO_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            app.manage(Shell {
                store: store::Store::open(dir.join("store.json")),
                alarms: alarms::Alarms::default(),
                replies: Mutex::default(),
                next_message: AtomicU64::new(1),
                next_window: AtomicU64::new(FIRST_WINDOW_ID),
                tray: Mutex::default(),
                paused: AtomicBool::new(false),
                popup_anchor: Mutex::default(),
                popup_closed: Mutex::default(),
                trace: std::env::var_os("SO_TRACE").is_some(),
            });
            let handle = app.handle().clone();
            *handle.state::<Shell>().tray.lock().unwrap() = Some(build_tray(&handle)?);

            // No Dock icon: the app lives in the menu bar (also LSUIElement in Info.plist).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // The page that runs service-worker.js. Never shown.
            build_window(&handle, BACKGROUND, "background.html")?.visible(false).build()?;

            // chrome.alarms: fire what is due, by the wall clock.
            let ticker = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(ALARM_TICK);
                for alarm in ticker.state::<Shell>().alarms.take_due(now_ms()) {
                    dispatch_to_background(&ticker, "alarm", &alarm.to_json());
                }
            });

            #[cfg(debug_assertions)]
            debug_hooks(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    // Closing the last window doesn't quit: the app stays in the status bar until Quit.
    app.run(|_app, event| {
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Where the background page loads from on macOS and Linux, and on Windows.
    const MAC_AND_LINUX: &str = "tauri://localhost/background.html";
    const WINDOWS: &str = "http://tauri.localhost/background.html";

    fn resolve(base: &str, url: &str) -> Result<String, String> {
        resolve_page(&tauri::Url::parse(base).unwrap(), url)
    }

    fn page(path: &str) -> Result<String, String> {
        Ok(path.to_string())
    }

    #[test]
    fn a_page_of_the_app_at_tauri_localhost_resolves_to_its_path() {
        assert_eq!(resolve(MAC_AND_LINUX, "tauri://localhost/popup.html"), page("popup.html"));
    }

    #[test]
    fn break_nows_fragment_and_a_query_are_kept() {
        assert_eq!(resolve(MAC_AND_LINUX, "tauri://localhost/break.html#manual"), page("break.html#manual"));
        assert_eq!(resolve(MAC_AND_LINUX, "trainer.html?area=neck"), page("trainer.html?area=neck"));
    }

    #[test]
    fn a_page_of_the_app_at_tauri_localhost_on_windows_resolves_to_its_path() {
        assert_eq!(resolve(WINDOWS, "http://tauri.localhost/break.html#manual"), page("break.html#manual"));
    }

    #[test]
    fn a_web_address_is_not_a_page_of_the_app() {
        for base in [MAC_AND_LINUX, WINDOWS] {
            assert!(resolve(base, "https://example.com/break.html").is_err(), "{base}");
        }
    }

    #[test]
    fn the_same_scheme_on_another_host_is_not_a_page_of_the_app() {
        assert!(resolve(MAC_AND_LINUX, "tauri://example.com/break.html").is_err());
        assert!(resolve(WINDOWS, "http://example.com/break.html").is_err());
    }

    #[test]
    fn another_port_on_the_apps_host_is_not_a_page_of_the_app() {
        assert!(resolve(WINDOWS, "http://tauri.localhost:8080/break.html").is_err());
    }
}
