# Living Docs Mobile

A small Expo app that acts as your personal endpoint for living-doc notifications. It mirrors the look and rhythm of the GitHub mobile app: clean white, blue accent, bottom tabs.

Current baseline: Expo SDK 54, React Native 0.81, React 19.1, TypeScript 5.9. Use Node 20.19.4 or newer.

## How it works

1. Sign in with GitHub on the device
2. Tap **Connect a repository** in Settings and pick any repo where you're an admin
3. The app silently installs two things into that repo:
   - An `EXPO_PUSH_TOKEN` secret (your device's push address, encrypted with the repo's public key)
   - A `.github/workflows/living-doc-notify.yml` workflow (the sender + feed writer)
4. Any time that workflow fires (manually, via `repository_dispatch`, or later via the `/living-doc` skill), it writes a structured event into the repo's `living-docs-feed` branch.
5. On app launch, foreground, or pull-to-refresh, the mobile app syncs those repo events into Inbox and the local doc registry.
6. If a real Expo push token is also available, the workflow sends a push notification as best-effort acceleration. Tapping the notification opens the referenced doc.

No backend, no server, no copy-paste.

## Running locally

```bash
cd mobile
npm install
npm start
```

Then:
- Press `i` for iOS simulator, `a` for Android emulator, or scan the QR with Expo Go
- `npm run web` is still useful for layout preview, but GitHub sign-in is not supported there until a proper web OAuth callback flow exists
- `npm run go` starts an Expo Go tunnel for quick phone testing
- `npm run dev-client` starts Metro for an installed development build

## Architecture

```
┌────────────┐   1-3. sign in + connect repo    ┌────────────┐
│ Mobile app │─────────────────────────────────>│   GitHub   │
└─────┬──────┘                                  └─────┬──────┘
      │                                               │
      │ 5. sync feed on open / refresh                │ 4. workflow fires
      │<──────────────────────────────────────────────┤
      │                                               │
      │ 6. optional push acceleration                 │
      │<──────────────────────────────────────────────┘
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
    ├── auth.tsx                  # GitHub device-flow auth
    ├── storage.ts                # SecureStore on native, localStorage on web
    ├── registry.ts               # Registered docs store (persisted)
    ├── delivery-feed.ts          # Feed branch/path contract shared by app + workflow
    ├── delivery-ingest.ts        # Shared event -> inbox/doc-registry ingestion
    ├── notifications.ts          # Expo push registration
    ├── sealed-box.ts             # crypto_box_seal via tweetnacl + blakejs
    ├── github-api.ts             # GitHub REST client (secrets + contents + feed sync)
    ├── workflow-template.ts      # YAML workflow embedded as a string
    ├── navigation.tsx            # Tabs + stack
    ├── components.tsx            # DocCard, Pill, EmptyState
    └── screens/
        ├── SignIn.tsx            # Device flow (native) + web limitation state
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

## Real push notifications

Expo Go and the web preview can run the app UI, but browser preview does not support GitHub sign-in yet and neither browser preview nor Expo Go can hold the native Expo push token that GitHub Actions needs for real delivery. Use a native build when you need actual sign-in and use an EAS development build when you need actual push notifications on a phone.

Repo-backed delivery no longer depends on that push path. A connected repo can write feed events into GitHub, and the app can pull them into Inbox and the doc registry on refresh. Real native push is still useful, but it is now optional acceleration rather than the only way for docs to become visible in the app.

Until that paid-team EAS path is available, **Settings → Trigger preview notification** can mimic delivery locally. On native runtimes it schedules a local notification; on web or when notification permission is unavailable it writes directly to Inbox. If the device already knows a doc, the preview notification points back into that doc so tap-to-open behavior can still be tested.

This repo now includes `expo-dev-client`, which is required for the real development-build path.

1. Sign in to Expo from this directory:

   ```bash
   cd mobile
   npx eas-cli login
   ```

   `npx expo login` is also acceptable if you already use the Expo CLI workflow.

2. Initialize the EAS project:

   ```bash
   npx eas-cli init
   ```

   This writes `extra.eas.projectId` into `app.json`. For Triadflow-owned builds, use the shared project. For personal fork testing, use your own Expo project and avoid committing an unrelated project ID back to this repo.

3. Confirm the build profiles in `eas.json`. This repo defines:

   - `development`: internal development client, iOS device build, Android APK
   - `preview`: internal distribution
   - `production`: empty production profile for future store builds

4. Create an iOS development build:

   ```bash
   npx eas-cli build --profile development --platform ios
   ```

   Expect this to take roughly 15 minutes. Open the EAS build link on the device and follow the install flow for the chosen credential/distribution mode.

5. Create an Android development build:

   ```bash
   npx eas-cli build --profile development --platform android
   ```

   Expect this to take roughly 10 minutes. Download the APK on the device, allow install from unknown sources if prompted, and install it.

6. Launch the installed development build. Grant notification permission when prompted.

7. Verify runtime status in the app:

   - Open **Settings**
   - Check **Push status**
   - It should read `Ready. This device can receive pushes from connected repos.`

8. Run the Metro dev server and connect the development build to it:

```bash
npm run dev-client
```

Scan the QR code or choose the listed development build target. Live reload should work from the installed dev build.

No CI is configured for EAS builds yet. Future work may add preview-track or auto-submit automation.

Verification status: not yet verified in this repo. After a reviewer completes a real device build, add a dated note here in the form `Verified EAS build on YYYY-MM-DD`.

## Verified flows

- Verified workflow install/update behavior on 2026-04-16 against `triadflow/mobile-connect-test`.
- Passed:
  - `EXPO_PUSH_TOKEN` secret creation
  - `.github/workflows/living-doc-notify.yml` creation with commit `Add Living Docs notify workflow`
  - Drift detection after a manual workflow edit
  - Workflow restore with commit `Update Living Docs notify workflow`
- Notes:
  - The same-session row can remain stale immediately after connect because GitHub secret visibility is eventually consistent; a fresh repo-list load converged to the correct state.
  - Real EAS push delivery remains unverified here.

## Roadmap

- [ ] Native re-render of living docs (no WebView) using the same registry JSON
- [x] Persistent inbox (SQLite)
- [x] Disconnect repo (remove secret + workflow)
- [ ] Multi-device fan-out (requires a backend — secret holds only one value)
- [ ] `/living-doc` skill integration: skill fires the workflow automatically when a doc changes

## License

MIT (see repo root).
