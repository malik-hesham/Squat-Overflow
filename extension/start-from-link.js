// Runs only on the start page (see content_scripts in manifest.json).
// Opening that page, for example from the Slack "Start break" link, triggers the same
// flow as "Break now" in the popup. A hosted page can read the result from a data
// attribute on <html>, because a content script lives in an isolated world.
const root = document.documentElement;
root.dataset.squatOverflow = "starting";

// The start URL may serve raw JSON (for example a 404 from our own API host), so there is
// no page to show the result. In that case draw a small message here. A real page is left alone.
function show(text) {
  if (document.contentType !== "application/json" || !document.body) return;
  document.body.textContent = "";
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText = "font:18px system-ui,sans-serif;padding:2rem;text-align:center";
  document.body.appendChild(p);
}

function finish(state, text) {
  root.dataset.squatOverflow = state;
  show(text);
}

show("Starting your break…");
chrome.runtime
  .sendMessage({ type: "break-now", source: "link" })
  .then((res) => {
    if (res && res.ok) finish("started", "Break started 🏋️ You can close this tab.");
    else finish("error", "Couldn't start the break. Try Break now from the extension popup.");
  })
  .catch(() => finish("error", "Couldn't reach the extension. Try Break now from the extension popup."));
