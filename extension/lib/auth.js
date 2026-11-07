import { CALENDAR_SCOPE } from "./calendar.js";

export const PERSONAL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "yandex.com", "mail.com", "zoho.com",
];

export function companyFromEmail(email) {
  const at = String(email ?? "").lastIndexOf("@");
  if (at < 1) return null;
  const domain = String(email).slice(at + 1).toLowerCase();
  if (!domain || PERSONAL_DOMAINS.includes(domain)) return null;
  return domain;
}

export function buildSignInUrl(clientId, redirectUri, hashedNonce, withCalendar) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "id_token token");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", ["openid", "email", "profile", ...(withCalendar ? [CALENDAR_SCOPE] : [])].join(" "));
  url.searchParams.set("nonce", hashedNonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function parseSignInResponse(redirectUrl, now) {
  const params = new URLSearchParams(new URL(redirectUrl).hash.replace(/^#/, ""));
  const idToken = params.get("id_token");
  const accessToken = params.get("access_token");
  if (!idToken || !accessToken || params.get("error")) return null;
  return { idToken, accessToken, expiresAt: now + Number(params.get("expires_in") || 3600) * 1000 };
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function newNonce() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export function toSession(body, now) {
  const meta = body.user?.user_metadata ?? {};
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + Number(body.expires_in || 3600) * 1000,
    user: { id: body.user?.id, email: body.user?.email, name: meta.full_name ?? "", picture: meta.avatar_url ?? "" },
  };
}
