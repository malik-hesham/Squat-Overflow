/**
 * The leaderboard is per company: players only see teammates who signed in with an
 * address on the same domain. Free mail providers don't identify a company, so they
 * can't join (the extension shows the same list to explain why).
 */
export const PERSONAL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'yandex.com', 'mail.com', 'zoho.com',
];

export function companyFromEmail(email: string | null | undefined): string | null {
  const at = String(email ?? '').lastIndexOf('@');
  if (at < 1) return null;
  const domain = String(email).slice(at + 1).toLowerCase();
  if (!domain || PERSONAL_DOMAINS.includes(domain)) return null;
  return domain;
}
