# Living Docs Mobile

A small Expo app that acts as your personal endpoint for living-doc notifications. It mirrors the look and rhythm of the GitHub mobile app: clean white, blue accent, bottom tabs.

## How it works

1. Sign in with GitHub on the device
2. Tap **Connect a repository** in Settings and pick any repo where you're an admin
3. The app silently installs two things into that repo:
   - An `EXPO_PUSH_TOKEN` secret (your device's push address, encrypted with the repo's public key)
   - A `.github/workflows/living-doc-notify.yml` workflow (the sender)
4. Any time that workflow fires (manually, via `repository_dispatch`, or later via the `/living-doc` skill), the push arrives on your phone. Tapping the notification opens the referenced doc.

No backend, no server, no copy-paste.

## Running locally

```bash
cd mobile
npm install
npm start
```

Then:
- Press `i` for iOS simulator, `a` for Android emulator, or scan the QR with Expo Go
- Or `npm run web` to preview in a browser (sign in uses a personal access token instead of device flow, because GitHub's OAuth device endpoints are CORS-blocked in browsers)

## Architecture

```
┌────────────────┐     1. sign in via device flow
│                │<─────────────────────────────┐
│  Mobile app    │                              │
│                │  2. pick repo -> encrypt    ┌─┴──────────┐
│                ├─────── push token ─────────>│            │
│                │  3. commit workflow file    │  GitHub    │
│                ├────────────────────────────>│            │
└────────┬───────┘                              └─────┬──────┘
         │                                            │
         │ 5. receive push                            │
         │                     4. workflow fires      │
         │                        (manual or skill)   │
         │                                            v
         │                                     ┌─────────────┐
         └─────────────────────────────────────┤ Expo push   │
                                               └─────────────┘
```

## Files

```
mobile/
├── App.tsx                       # Root: providers + navigation
├── index.ts                      # registerRootComponent (polyfills first)
├── app.json                      # Expo config
├── package.json
├── tsconfig.json
└── src/
    ├── theme.ts                  # Colors, radii, spacing, typography
    ├── auth.tsx                  # GitHub device-flow + PAT fallback (web)
    ├── storage.ts                # SecureStore on native, localStorage on web
    ├── registry.ts               # Registered docs store (persisted)
    ├── notifications.ts          # Expo push registration
    ├── sealed-box.ts             # crypto_box_seal via tweetnacl + blakejs
    ├── github-api.ts             # GitHub REST client (secrets + contents)
    ├── workflow-template.ts      # YAML workflow embedded as a string
    ├── navigation.tsx            # Tabs + stack
    ├── components.tsx            # DocCard, Pill, EmptyState
    └── screens/
        ├── SignIn.tsx            # Device flow (native) / PAT (web)
        ├── Home.tsx              # Registered docs list
        ├── DocDetail.tsx         # WebView, pull-to-refresh
        ├── Inbox.tsx             # Raw notification log
        ├── Settings.tsx          # Profile + link to Repos
        └── Repos.tsx             # Connect/disconnect any admin repo
```

## GitHub OAuth app

The `githubClientId` in `app.json` is a public identifier (device flow doesn't use a client secret). If you fork this repo, create your own OAuth App:

1. https://github.com/settings/applications/new
2. Homepage URL: any
3. Authorization callback URL: any (device flow doesn't use it, but it's required)
4. After creation, **enable Device Flow** in settings
5. Replace `githubClientId` in `app.json` with your new client ID

## Push notifications caveat

Real push notifications require an EAS project:

```bash
npx eas init                    # one-time, ties to your Expo account
npx eas build --profile development
```

In Expo Go / web preview the app runs fully, but `expo-notifications` returns no token. You can still use the app to Connect repos; the wiring is idempotent so when you move to an EAS build you just tap Connect again and the secret refreshes.

## Roadmap

- [ ] Native re-render of living docs (no WebView) using the same registry JSON
- [ ] Persistent inbox (SQLite)
- [ ] Disconnect repo (remove secret + workflow)
- [ ] Multi-device fan-out (requires a backend — secret holds only one value)
- [ ] `/living-doc` skill integration: skill fires the workflow automatically when a doc changes

## License

MIT (see repo root).
