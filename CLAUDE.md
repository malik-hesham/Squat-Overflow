# Squat Overflow

## The browser extension is the reference client

`extension/` defines every feature and every business rule: what a break does, XP, levels, streaks, challenges, badges, the schedule, privacy, demo clips, sounds, i18n strings and the leaderboard. The other clients follow it:

- `mobile/` (React Native, iOS and Android)
- `macos/` (the SwiftUI menu bar app)

When you add or change a feature or a rule in any client:

1. Find how the extension does it (`extension/break.js`, `extension/lib/*`, `extension/background.js`, and `server/` for anything the extension gets from the pose server) and do the same in the other client. Same defaults, same limits, same wording, same edge cases. For example, mobile privacy mode blurs the camera like the extension's "Blur" look; it doesn't invent its own look.
2. Mobile imports the extension's pure modules from `../extension/lib` (see `mobile/src/core/shared.ts`). Reuse them; don't copy or re-implement the logic. The macOS app can't import JS, so it ports the rule and says in a comment which extension file it follows.
3. If a change starts in mobile or macOS, either make the same change in the extension or say clearly why it's platform-only.
4. A platform can't always match (no camera on the menu bar app, no fullscreen detection on a phone, no real blur on Android before 12). Write each gap down in that client's README ("How it maps to the extension" in `mobile/README.md`, the feature list in `macos/README.md`). Keep the gap as small as the platform allows, and pick the option that keeps the user's privacy.
5. Tests that pin a shared rule should cover every client the rule ships in.

## AWS: Free plan only, no upgrade

The pose server runs in AWS account `323036354551` (IAM Identity Center in `us-east-1`, CLI profile `squat-overflow`; setup in [docs/aws-free-plan.md](docs/aws-free-plan.md)). The account is on the AWS **Free plan** and we are **not** upgrading it to the Paid plan.

1. Never upgrade the account plan, and never suggest upgrading as a fix. Nothing in this repository calls `aws freetier upgrade-account-plan`, and `deploy/tests/` checks that.
2. Use only what the Free plan allows: EC2 instance types marked *Free tier eligible* (`deploy/aws-provision.sh` refuses any other type), and services the plan doesn't block.
3. Keep the single-host design in `deploy/`: one EC2 instance with an Elastic IP, and Caddy and Postgres in Docker on that instance. Don't add always-on paid resources (load balancer, RDS, NAT gateway, Fargate, extra public IPv4 addresses). They would use up the $100–200 of credits in weeks.
4. Any change that adds an AWS resource says what it costs per month. The whole deploy stays under the $25/month budget alert.
5. The Free plan ends after 6 months or when the credits run out, whichever comes first, and the account then **closes**. Plan for that: the server's hostname is a DNS name we own, backups are copied off the instance, and docs/aws-free-plan.md says how to move off before the end date. `aws freetier get-account-plan-state --profile squat-overflow --region us-east-1` shows the credits left and the end date.
