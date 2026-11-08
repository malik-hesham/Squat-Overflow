// "Continue with Google" and the signed-in account line, as on the extension's options page.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Muted } from '@/src/components/kit';
import { t } from '@/src/core/i18n';
import { SignInCancelled, signIn, type Session } from '@/src/core/session';
import { companyFromEmail } from '@/src/core/shared';

export function SignInButton({ lang, onSignedIn }: { lang: string; onSignedIn?: (session: Session) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      onSignedIn?.(await signIn());
    } catch (err) {
      if (!(err instanceof SignInCancelled)) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-1.5">
      <Button variant="secondary" disabled={busy} onPress={start}>
        {busy ? <ActivityIndicator /> : null}
        <Text>{t(lang, 'continueGoogle')}</Text>
      </Button>
      {failed ? <Text className="text-destructive text-sm">{t(lang, 'signInFailed')}</Text> : null}
    </View>
  );
}

/** Who's signed in and which company board that puts them on, with Sign out; or the sign-in pitch. */
export function Account({
  lang,
  session,
  onSignedIn,
  onSignOut,
}: {
  lang: string;
  session: Session | null | undefined;
  onSignedIn?: (session: Session) => void;
  onSignOut: () => void;
}) {
  if (session === undefined) return <ActivityIndicator />;
  if (!session) {
    return (
      <View className="gap-2">
        <Muted>{t(lang, 'signInWhy')}</Muted>
        <SignInButton lang={lang} onSignedIn={onSignedIn} />
      </View>
    );
  }
  const company = companyFromEmail(session.user.email);
  return (
    <View className="gap-2">
      <Text className="text-sm">{t(lang, 'signedInAs', { email: session.user.email })}</Text>
      <Muted>{company ? t(lang, 'companyFrom', { domain: company }) : t(lang, 'companyPersonal')}</Muted>
      <Button variant="outline" onPress={onSignOut}>
        <Text>{t(lang, 'signOut')}</Text>
      </Button>
    </View>
  );
}
