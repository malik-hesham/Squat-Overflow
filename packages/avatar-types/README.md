# @squat-overflow/avatar-types

The shared contracts of the digital human engine: avatar states, expressions, ARKit blendshapes,
visemes, commands, events, the `AvatarController` API, speech responses, the per-frame output core hands
to renderers, the platform ports, and the asset manifest. Design and rationale:
[docs/digital-human/architecture.md](../../docs/digital-human/architecture.md), section 3.

Runtime code is limited to constant lists and two parsers for data that crosses a trust boundary:

- `parseSpeechResponse(input)` for responses from the speech service;
- `parseAvatarCommand(input)` for commands that arrive as messages (extension, Tauri IPC).

Both return `{ ok: true, value }` with only the known fields, or `{ ok: false, errors }` listing every
problem with its path (`visemes[2].weight: must be a number from 0 to 1`).

All times are milliseconds from the start of the audio; angles are radians.

This package has no dependencies and compiles with no DOM or Node globals (checked by
`tools/workspace-check`), so it runs unchanged in the extension, the desktop app, the mobile app and
on the server.

```bash
pnpm --filter @squat-overflow/avatar-types test       # unit tests
pnpm --filter @squat-overflow/avatar-types typecheck  # also checks the type tests in contracts.test.ts
```
