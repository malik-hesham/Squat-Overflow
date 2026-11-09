# TODO: finish mobile Google sign-in

The code is done and pushed in PR #11 (`feat/nestjs-pose-server`). These steps are left to do by hand.

## 1. Register the redirect URI with Google

- [ ] Open Google Cloud Console → **APIs & Services → Credentials**.
- [ ] Open the extension's **web** OAuth client: `977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com`.
- [ ] Under **Authorized redirect URIs**, add `https://<API server host>/auth/mobile-callback`.
      There is no hosted server, so this needs the API server (`server/`) running with public HTTPS
      (see `docs/deployment.md`), and `API_URL` in `extension/config.js` pointed at it for the
      mobile build. The default `http://127.0.0.1:8765` can't be a Google redirect from a device.
- [ ] Save. Google can take a few minutes to apply the change.

Until this is saved, mobile sign-in fails with Google's `redirect_uri_mismatch` error.

## 2. Deploy the server

The relay page (`GET /auth/mobile-callback`) is on the API server. Releases don't deploy the server.

- [ ] Merge PR #11 into `main`.
- [ ] Deploy `server/` from this code to your host (`docs/deployment.md`, "Running the API server").
- [ ] Check that the page is live. This should print `200`:
      ```bash
      curl -s -o /dev/null -w "%{http_code}\n" https://<API server host>/auth/mobile-callback
      ```

## 3. Rebuild the mobile dev client

The app gained two native modules (`expo-web-browser`, `expo-secure-store`), so the old dev client won't load the new code.

- [ ] iOS (`pod install` needs the UTF-8 locale):
      ```bash
      cd mobile && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios
      ```
- [ ] Android:
      ```bash
      cd mobile && npx expo run:android
      ```

## 4. Test sign-in on a device

- [ ] **Android emulator first.** This is the riskiest step: Chrome Custom Tabs may not open the app from the relay page on its own. If it doesn't, the page has a **Return to Squat Overflow** button. Check that tapping it finishes sign-in.
- [ ] iOS simulator: the sign-in sheet closes and you're signed in.
- [ ] Work Google account → Settings shows "Company: <domain>", and the leaderboard loads.
- [ ] Personal Gmail account → the board says it needs a work email.
- [ ] Close the sign-in sheet without signing in → no error message.
- [ ] Competitive mode, finish a break → your score shows on the board.
- [ ] Sign out while in competitive mode → you're off the board and back in Personal mode.

## 5. Wrap up

- [ ] Once the device tests pass, remove the "Not tested yet" line from the PR #11 description.
- [ ] Delete this file.
