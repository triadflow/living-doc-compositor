# Living Docs Mobile

A small Expo app that acts as your personal endpoint for living-doc notifications. It mirrors the look and rhythm of the GitHub mobile app: clean white, blue accent, bottom tabs.

Current baseline: Expo SDK 54, React Native 0.81, React 19.1, TypeScript 5.9. Use Node 20.19.4 or newer.

## How it works

1. Sign in with GitHub on the device
2. Tap **Connect a repository** in Settings and pick any repo where you're an admin
3. The app silently installs two things into that repo:
   - An `EXPO_PUSH_TOKEN` secret (your device's push address, encrypted with the repo's public key)
   - A `.github/workflows/living-doc-notify.yml` workflow (the sender + feed writer)
4. Each connected repo can also carry a minimal `.living-docs/manifest.json` file that mirrors delivery-critical living-doc metadata from the central registry:
   - `docId`
   - `title`
   - `publicUrl`
   - `trackedPaths`
5. Any time the workflow fires, it writes a structured event into the repo's `living-docs-feed` branch:
   - manually via `workflow_dispatch`
   - programmatically via `repository_dispatch`
   - automatically on `push` to the default branch when changed files match manifest-backed living-doc paths
6. On app launch, foreground, or pull-to-refresh, the mobile app syncs those repo events into Inbox and the local doc registry.
7. If a real Expo push token is also available, the workflow sends a push notification as best-effort acceleration. Tapping the notification opens the referenced doc.

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
- `npm run ios:preview` builds a local iOS preview with remote-notification entitlements stripped when you only need UI work

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
    ├── delivery-manifest.ts      # Repo-local manifest path contract
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

repo root
├── .living-docs/manifest.json    # Minimal delivery mirror used by push-triggered feed generation
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

Automatic commit-driven delivery now depends on a repo-local `.living-docs/manifest.json`. The central living-doc registry remains the richer cross-system catalog, but GitHub Actions can only inspect files inside the connected repo, so this minimal mirror is the contract that lets `push` events resolve changed doc paths into titles and public URLs.

Until that paid-team EAS path is available, **Settings → Trigger preview notification** can mimic delivery locally. On native runtimes it schedules a local notification; on web or when notification permission is unavailable it writes directly to Inbox. If the device already knows a doc, the preview notification points back into that doc so tap-to-open behavior can still be tested.

This repo now includes `expo-dev-client`, which is required for the real development-build path.

1. Sign in to Expo from this directory:

   ```bash
   cd mobile
   npx eas-cli login
   ```

   `npx expo login` is also acceptable if you already use the Expo CLI workflow.

2. This repo is already bound to the shared Triadflow Expo project in `app.json`:

   - `owner: triadflow`
   - `extra.eas.projectId: 94670052-2f49-4ec0-b569-bd0cac302ad9`

   Keep that config when building from the canonical repo.

3. If you are testing from a fork or personal clone, rebind to your own Expo project:

   ```bash
   npx eas-cli init
   ```

   That writes your own `extra.eas.projectId` into `app.json`. Do not commit an unrelated personal project ID back into the shared repo.

4. Confirm the build profiles in `eas.json`. This repo defines:

   - `development`: internal development client, iOS device build, Android APK
   - `preview`: internal distribution
   - `production`: empty production profile for future store builds

5. Create an iOS development build:

   ```bash
   npx eas-cli build --profile development --platform ios
   ```

   Expect this to take roughly 15 minutes. Open the EAS build link on the device and follow the install flow for the chosen credential/distribution mode.

6. Create an Android development build:

   ```bash
   npx eas-cli build --profile development --platform android
   ```

   Expect this to take roughly 10 minutes. Download the APK on the device, allow install from unknown sources if prompted, and install it.

7. Launch the installed development build. Grant notification permission when prompted.

8. Verify runtime status in the app:

   - Open **Settings**
   - Check **Push status**
   - It should read `Ready. This device can receive pushes from connected repos.`

9. Run the Metro dev server and connect the development build to it:

```bash
npm run dev-client
```

Scan the QR code or choose the listed development build target. Live reload should work from the installed dev build.

No CI is configured for EAS builds yet. Future work may add preview-track or auto-submit automation.

Verification status: not yet verified in this repo. After a reviewer completes a real device build, add a dated note here in the form `Verified EAS build on YYYY-MM-DD`.

## Verified flows

- Verified workflow install/update behavior on 2026-04-16 against `triadflow/mobile-connect-test`.
- Verified repo-backed delivery feed behavior on 2026-04-16 against `triadflow/mobile-connect-test`.
- Verified throwaway-repo connect/disconnect behavior on 2026-04-19 against `triadflow/mobile-connect-e2e-20260419-123346`.
- Passed:
  - `EXPO_PUSH_TOKEN` secret creation
  - `.github/workflows/living-doc-notify.yml` creation with commit `Add Living Docs notify workflow`
  - Drift detection after a manual workflow edit
  - Workflow restore with commit `Update Living Docs notify workflow`
  - Manual workflow run `24510668921` created branch `living-docs-feed`
  - Feed event file `2026-04-16T12-39-10Z--triadflow-mobile-connect-test-24510668921-1.json`
  - Feed event payload carried title, body, repo, source, createdAt, and doc URL as expected
  - Throwaway repo fixture commit `9945643` established `.living-docs/manifest.json` plus tracked doc files
  - Connect pass created workflow commit `2ba6418`, drift commit `c2ca2a3`, and restore commit `aec8ce9`
  - Manual dispatch run `24629243483` wrote feed file `2026-04-19T12-36-29Z--triadflow-mobile-connect-e2e-20260419-123346-24629243483-1-1.json`
  - Manifest-backed push commit `548a3d8` triggered run `24629263428` and wrote feed file `2026-04-19T12-37-36Z--triadflow-mobile-connect-e2e-20260419-123346-24629263428-1-1.json`
  - Secret-only disconnect left workflow delivery active; manual dispatch run `24629278524` wrote feed file `2026-04-19T12-38-28Z--triadflow-mobile-connect-e2e-20260419-123346-24629278524-1-1.json` and logged `No Expo push token configured`
  - Full disconnect removed workflow commit `2f15e98`; later tracked-doc push commit `818e06e` produced no new workflow run and no new feed file
  - Real iPhone Expo Go preview connect showed `Wired for preview` / `preview-connected` for `triadflow/mobile-connect-e2e-20260419-123346`, and the connected repo immediately recorded workflow-install push run `24629696669`
  - Manual verification runs `24629714376` and `24629722084` wrote feed files `2026-04-19T13-01-23Z--triadflow-mobile-connect-e2e-20260419-123346-24629714376-1-1.json` and `2026-04-19T13-01-48Z--triadflow-mobile-connect-e2e-20260419-123346-24629722084-1-1.json`
  - The same phone Inbox showed both `Phone preview verification event` and `Phone preview verification event 13:01` after refresh
  - Structured manual run `24630301322` wrote feed file `2026-04-19T13-32-37Z--triadflow-mobile-connect-e2e-20260419-123346-24630301322-1-1.json`, and the iPhone Inbox rendered `Grounded smoke-doc verification 13:32` with the richer block-aware row UI
  - Auto-generated grounded push commit `b1013ee` triggered run `24630808033`, wrote feed file `2026-04-19T13-59-18Z--triadflow-mobile-connect-e2e-20260419-123346-24630808033-1-1.json`, and the same iPhone Inbox showed `Repo preview loop updated` with the `ready -> grounded` transition after refresh
- Notes:
  - The same-session row can remain stale immediately after connect because GitHub secret visibility is eventually consistent; a fresh repo-list load converged to the correct state.
  - The test repo still held the preview placeholder token, so Expo push was skipped intentionally while repo-feed delivery succeeded.
  - Expo Go on a real phone now proves the preview-mode row state, synced Inbox delivery path, manual structured grounded rows, and automatic grounded push rows, but not native push-token registration.
  - Real EAS push delivery remains unverified here.

## Roadmap

- [ ] Native re-render of living docs (no WebView) using the same registry JSON
- [x] Persistent inbox (SQLite)
- [x] Disconnect repo (remove secret + workflow)
- [ ] Multi-device fan-out (requires a backend — secret holds only one value)
- [ ] `/living-doc` skill integration: skill fires the workflow automatically when a doc changes

## License

MIT (see repo root).
