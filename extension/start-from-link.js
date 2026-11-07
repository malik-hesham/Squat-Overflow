// Runs only on the Squat Overflow start page (see content_scripts in manifest.json).
// Opening that page, for example from the Slack "Start break" button, triggers the
// same flow as "Break now" in the popup. The page reads the result from a data
// attribute on <html>, because a content script lives in an isolated world.
const root = document.documentElement;
root.dataset.squatOverflow = "starting";
chrome.runtime
  .sendMessage({ type: "break-now", source: "link" })
  .then((res) => {
    root.dataset.squatOverflow = res && res.ok ? "started" : "error";
  })
  .catch(() => {
    root.dataset.squatOverflow = "error";
  });
