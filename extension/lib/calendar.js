export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

export function buildAuthUrl(clientId, redirectUri, interactive) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("prompt", interactive ? "consent" : "none");
  return url.toString();
}

export function parseAuthResponse(redirectUrl, now) {
  const hash = new URL(redirectUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token || params.get("error")) return null;
  return { token, expiresAt: now + Number(params.get("expires_in") || 3600) * 1000 };
}

export function parseBusy(body) {
  const busy = body?.calendars?.primary?.busy ?? [];
  return busy
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    .sort((a, b) => a.start - b.start);
}

export function busyNow(busy, now) {
  return busy.find((b) => b.start <= now && now < b.end) ?? null;
}

export function nextMeeting(busy, now) {
  return busy.find((b) => b.start > now) ?? null;
}

const GAP_MIN = 10;
const AGENDA_MS = 24 * 3_600_000;

export function agenda(busy, now, limit = 5) {
  const day = (t) => new Date(t).toDateString();
  const upcoming = busy.filter((b) => b.end > now && b.start < now + AGENDA_MS).slice(0, limit);
  const items = [];
  upcoming.forEach((b, k) => {
    const prev = upcoming[k - 1];
    if (prev && day(prev.end) === day(b.start)) {
      const minutes = Math.round((b.start - prev.end) / 60_000);
      if (minutes >= GAP_MIN) items.push({ type: "gap", minutes });
    }
    items.push({ type: "meeting", start: b.start, end: b.end, now: b.start <= now, tomorrow: day(b.start) !== day(now) });
  });
  return items;
}
