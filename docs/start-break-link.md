# Start a break from a link (for example from Slack)

Opening a hosted start page triggers the same flow as **Break now** in the extension popup. The webcam exercise still runs in the extension, so the link only works in a browser that has Squat Overflow installed and enabled. It does nothing on a phone.

## How it works

1. Someone opens `https://<host>/start/` (shared in Slack, pinned, bookmarked, anywhere).
2. A content script in the extension (`extension/start-from-link.js`) runs only on that page and sends `{ type: "break-now" }` to the service worker, exactly like the popup button.
3. The script sets `document.documentElement.dataset.squatOverflow` to `starting`, then `started` or `error`, so the page can show the result.

No Slack code, accounts or secrets are involved.

## Default start URL (no hosting needed)

The extension is set up to use this project's own server, the hosted pose and API server, as the start link:

`https://squat-overflow-pose.fly.dev/start/`

That address returns a JSON 404, which is fine: the content script still runs on it, starts the break, and draws a short "Break started" message itself. Nothing has to be hosted. The same URL is `START_PAGE_URL` in `extension/config.js`, and it is what the Slack message's **Start break** link and button point to.

To use a nicer hosted page later, change `START_PAGE_URL` and the `content_scripts[0].matches` entry in `extension/manifest.json` to the new host (details below). The script only draws its own message when the page is raw JSON, so a real page is left alone.

## The hosted page (handled separately)

It needs to be an `https` page whose path starts with `/start`. It can be fully static. A minimal working page (save as `start/index.html` on the host):

```html
<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Start a break · Squat Overflow</title>
<h1 id="t">Starting your break…</h1><p id="m"></p>
<script>
  const t = document.getElementById("t"), m = document.getElementById("m");
  const t0 = Date.now();
  const timer = setInterval(() => {
    const v = document.documentElement.dataset.squatOverflow;
    if (v === "started") { t.textContent = "Break started"; m.textContent = "You can close this tab."; clearInterval(timer); }
    else if (v === "error") { t.textContent = "Couldn't start the break"; m.textContent = "Try Break now from the extension popup."; clearInterval(timer); }
    else if (Date.now() - t0 > 4000) { t.textContent = "Squat Overflow extension not found"; m.textContent = "Open this link in the Chrome profile where the extension is installed and enabled."; clearInterval(timer); }
  }, 250);
</script>
```

## When the URL is known

1. In `extension/manifest.json`, set `content_scripts[0].matches` to `https://<host>/start*`. It currently holds `https://squat-overflow-pose.fly.dev/start*`.
2. Reload the extension at `chrome://extensions`. Everyone using a packaged copy needs the updated extension, because the content script ships with it.
3. Open `https://<host>/start/` and check that a break window opens.

## Using it from Slack

Just share the link: paste `https://<host>/start/` in a channel, pin it, or add it as a channel bookmark. To post a button instead, send this once through an incoming webhook (the webhook URL is a secret, so don't put it in the repo):

```
{"text":"Time to move?","blocks":[{"type":"actions","elements":[{"type":"button","text":{"type":"plain_text","text":"Start break"},"style":"primary","url":"https://<host>/start/"}]}]}
```

## Notes

- Opening the page is enough to start a break, so only share it with people who use the extension. It can only open a break in the visitor's own extension and can't read or change anything.
- The extension only accepts the message from its own content script (the service worker checks the sender), so other websites can't trigger it.
