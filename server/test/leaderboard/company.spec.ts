import { PERSONAL_DOMAINS, companyFromEmail } from '../../src/leaderboard/company';

describe('companyFromEmail', () => {
  test('returns the lower-cased domain of a work email', () => {
    expect(companyFromEmail('malik@leadliaison.com')).toBe('leadliaison.com');
    expect(companyFromEmail('Malik@LeadLiaison.COM')).toBe('leadliaison.com');
  });

  test('returns null for personal mail providers, in any case', () => {
    expect(PERSONAL_DOMAINS).toHaveLength(16);
    for (const d of PERSONAL_DOMAINS) expect(companyFromEmail(`a@${d}`)).toBeNull();
    expect(companyFromEmail('Someone@GMAIL.com')).toBeNull();
  });

  test.each(['', 'nobody', '@leadliaison.com', 'a@', null, undefined])('returns null for malformed %p', (bad) => {
    expect(companyFromEmail(bad)).toBeNull();
  });
});
