// Posts a "break time" message to a Slack incoming webhook.
// The webhook URL lives in config.js, so anyone with the extension can read it.
const HOOK_PREFIX = "https://hooks.slack.com/services/";

export function isSlackWebhook(url) {
  return typeof url === "string" && url.startsWith(HOOK_PREFIX) && url.length > HOOK_PREFIX.length;
}

// Slack treats <...> as markup (for example <!channel>), so escape player names.
export function escapeSlack(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function httpsUrl(url) {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function slackPayload({ name, startUrl, manual }) {
  const who = escapeSlack(String(name ?? "").trim().slice(0, 40));
  const text = manual
    ? who ? `🏋️ *${who}* started a break.` : "🏋️ A break just started."
    : who ? `🏋️ *${who}*, time to move!` : "🏋️ Time to move!";
  const url = httpsUrl(startUrl);
  // The link also goes in the message text, so it stays clickable where buttons are not shown.
  const body = url ? `${text}\n<${url}|Start break>` : text;
  const blocks = [{ type: "section", text: { type: "mrkdwn", text: body } }];
  if (url) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Start break 🏋️", emoji: true }, style: "primary", url, action_id: "start_break" }],
    });
  }
  return { text, blocks };
}

// Never throws and never blocks a break for long: a failed post just returns false.
export async function notifySlack({ webhookUrl, startUrl, name, manual }, fetchImpl = fetch, timeoutMs = 5000) {
  if (!isSlackWebhook(webhookUrl)) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload({ name, startUrl, manual })),
      signal: ctl.signal,
    });
    return res.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
