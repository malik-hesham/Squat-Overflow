"use strict";

const path = require("path");
const vscode = require("vscode");

let hostHandle = null;
const openPanels = new Set();
// wids (strings) whose automatic-reminder notification is still showing
const pendingNotifications = new Set();
// wids whose notification was accepted and whose page was opened
const acceptedWids = new Set();

function escapeAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PAGE_TITLES = {
  "break.html": "StandUp Break",
  "trainer.html": "Practice",
  "popup.html": "Dashboard",
  "options.html": "Settings",
};

async function activate(context) {
  const { createHost } = await import("./host/index.mjs");

  let stored = context.globalState.get("storageLocal", {});
  const state = {
    get() {
      return stored;
    },
    set(obj) {
      stored = obj;
      return context.globalState.update("storageLocal", obj);
    },
  };

  let lastActivity = Date.now();
  const touch = () => {
    lastActivity = Date.now();
  };
  const outputChannel = vscode.window.createOutputChannel("StandUp Break");
  context.subscriptions.push(outputChannel);
  const log = (msg) => outputChannel.appendLine(new Date().toISOString() + " " + msg);
  const idleState = (sec) => {
    const focused = vscode.window.state.focused === true;
    const ago = Date.now() - lastActivity;
    const result = focused || ago <= sec * 1000 ? "active" : "idle";
    log(
      `idleState(${sec}) -> ${result} focused=${focused} lastActivityAgo=${Math.round(ago / 1000)}s`
    );
    return result;
  };

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(touch),
    vscode.workspace.onDidChangeTextDocument(touch),
    vscode.window.onDidChangeActiveTextEditor(touch),
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) touch();
    }),
    vscode.window.onDidOpenTerminal(touch),
    vscode.window.onDidChangeActiveTerminal(touch)
  );

  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusItem.command = "standupBreak.showMenu";
  statusItem.text = "$(pulse) StandUp";
  statusItem.show();
  context.subscriptions.push(statusItem);

  const onBadge = (badge) => {
    statusItem.text = `$(pulse) ${badge.text || "StandUp"}`;
    statusItem.tooltip = badge.title;
    statusItem.backgroundColor =
      badge.text === "move"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  };

  const cfg = () => vscode.workspace.getConfiguration("standupBreak");
  const port = cfg().get("port");

  let host = null;
  const panelsByWid = new Map();

  const openPage = async (p, { base } = {}) => {
    const root = base || (host && host.baseUrl);
    const file = p.split(/[?#]/)[0];
    const mode = cfg().get("openIn") === "editor" ? "editor" : "browser";
    const url = root + "/" + p;

    if (mode === "browser" && (file === "break.html" || file === "trainer.html")) {
      return vscode.env.openExternal(vscode.Uri.parse(url));
    }

    const widMatch = /[?&]__wid=(\d+)/.exec(url.split("#")[0]);
    const wid = widMatch ? Number(widMatch[1]) : null;
    if (wid !== null && panelsByWid.has(wid)) {
      panelsByWid.get(wid).reveal(vscode.ViewColumn.Active, false);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "standupBreak.page",
      PAGE_TITLES[file] || "StandUp Break",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src http://127.0.0.1:* http://localhost:*; style-src \'unsafe-inline\';">' +
      "<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>" +
      '</head><body><iframe src="' +
      escapeAttr(url) +
      '" allow="autoplay; clipboard-write"></iframe></body></html>';

    openPanels.add(panel);
    if (wid !== null) panelsByWid.set(wid, panel);
    panel.onDidDispose(() => {
      openPanels.delete(panel);
      if (wid !== null && panelsByWid.get(wid) === panel) {
        panelsByWid.delete(wid);
        if (host) host.host.windowClosed(wid);
      }
    });
  };

  const openUrlNow = (url) => {
    const u = new URL(url);
    const segments = u.pathname.split("/");
    const base = u.origin + "/" + segments[1];
    const rest = segments.slice(2).join("/") + u.search + u.hash;
    return openPage(rest, { base });
  };

  const openUrl = (url) => {
    const u = new URL(url);
    const isAutoBreak =
      u.pathname.endsWith("/break.html") && u.hash !== "#manual";
    const logSegs = u.pathname.split("/");
    log(
      `openUrl ${u.origin}/<token>/${logSegs.slice(2).join("/")}${u.search}${u.hash} auto=${isAutoBreak}`
    );
    if (!isAutoBreak) return openUrlNow(url);
    const widParam = u.searchParams.get("__wid");
    if (widParam !== null) {
      if (pendingNotifications.has(widParam)) return undefined;
      // Window already opened by an accepted notification: focus/re-open.
      if (acceptedWids.has(widParam)) return openUrlNow(url);
      pendingNotifications.add(widParam);
    }
    return Promise.resolve(
      vscode.window.showInformationMessage(
        "Time to move!",
        {
          modal: true,
          detail: "Your StandUp break is ready. Stand up, stretch and take 2 minutes.",
        },
        "Start"
      )
    ).then(
      (choice) => {
        log(`notification resolved: ${choice}`);
        if (widParam !== null) pendingNotifications.delete(widParam);
        if (choice !== "Start") return false;
        if (widParam !== null) acceptedWids.add(widParam);
        openUrlNow(url);
        return true;
      },
      (err) => {
        if (widParam !== null) pendingNotifications.delete(widParam);
        throw err;
      }
    );
  };

  host = await createHost({
    webDir: path.join(context.extensionPath, "web"),
    shimPath: path.join(context.extensionPath, "src/host/page-shim.js"),
    state,
    openUrl,
    idleState,
    onBadge,
    port,
  });
  hostHandle = host;

  host.chrome.windows.onRemoved.addListener((id) => {
    acceptedWids.delete(String(id));
    const panel = panelsByWid.get(id);
    if (panel) {
      panelsByWid.delete(id);
      panel.dispose();
    }
  });

  const menu = [
    { label: "Break now", command: "standupBreak.breakNow" },
    { label: "Pause 1 hr", command: "standupBreak.pause" },
    { label: "Resume", command: "standupBreak.resume" },
    { label: "Dashboard", command: "standupBreak.openDashboard" },
    { label: "Settings", command: "standupBreak.openSettings" },
    { label: "Practice", command: "standupBreak.openPractice" },
  ];

  const register = (id, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register("standupBreak.breakNow", () =>
    host.host.dispatchMessage({ type: "break-now" })
  );
  register("standupBreak.pause", () =>
    host.host.dispatchMessage({ type: "pause" })
  );
  register("standupBreak.resume", () =>
    host.host.dispatchMessage({ type: "resume" })
  );
  register("standupBreak.openDashboard", () => openPage("popup.html"));
  register("standupBreak.openSettings", () => openPage("options.html"));
  register("standupBreak.openPractice", () =>
    openPage("trainer.html")
  );
  register("standupBreak.showLog", () => outputChannel.show());
  register("standupBreak.showMenu", async () => {
    const picked = await vscode.window.showQuickPick(menu);
    if (picked) await vscode.commands.executeCommand(picked.command);
  });

  context.subscriptions.push({
    dispose() {
      deactivate();
    },
  });
}

async function deactivate() {
  const h = hostHandle;
  hostHandle = null;
  for (const panel of [...openPanels]) panel.dispose();
  openPanels.clear();
  if (h) await h.dispose();
}

module.exports = { activate, deactivate };
