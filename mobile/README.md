# Living Docs Mobile

A small Expo app that lists your living docs, opens each one in-app, and receives push notifications from GitHub Actions.

Built to match the look and rhythm of the GitHub mobile app: clean white, blue accent, bottom tabs.

## Features

- **GitHub sign-in** via OAuth device flow. No backend, no client secret.
- **Docs tab** lists every HTML under `docs/` in the repo, pulled from the GitHub API.
- **Detail view** renders the living doc in a WebView (served from GitHub Pages).
- **Inbox tab** shows incoming push notifications. Tapping one opens the relevant doc.
- **Settings tab** surfaces the Expo push token for copy-paste into a repo secret.

## One-time setup

### 1. Create a GitHub OAuth App

1. https://github.com/settings/applications/new
2. **Application name**: Living Docs (or whatever you like)
3. **Homepage URL**: https://triadflow.github.io/living-doc-compositor/
4. **Authorization callback URL**: `livingdocs://oauth` (unused by device flow but required)
5. After creation, **enable Device Flow** in the OAuth App settings.
6. Copy the **Client ID** and paste it into `app.json`:

```jsonc
// mobile/app.json
"extra": {
  "githubClientId": "Iv1.xxxxxxxxxxxxxxxx"
}
```

No client secret is needed for the device flow.

### 2. Install & run

```bash
cd mobile
npm install
npm start
```

Press `i` for the iOS simulator or `a` for Android emulator. Or scan the Expo Go QR with your phone (push notifications require a development build or Expo Go Plus).

### 3. Push notifications (optional)

Push needs an EAS project ID. Create one when you're ready to ship:

```bash
npx eas init            # creates an EAS project, writes projectId to app.json
npx eas build --profile development
```

Once built, open the app once to grant notification permission. Copy the Expo push token from the Settings tab into a **repo secret** named `EXPO_PUSH_TOKEN`.

### 4. Test the notification flow

```bash
gh workflow run living-doc-notify.yml \
  -f title="Test" \
  -f body="Hello from GitHub Actions" \
  -f doc="living-doc-template-starter-ship-feature.html"
```

The app should ping within seconds. Tapping the notification opens the named doc.

## What the workflow does

`.github/workflows/living-doc-notify.yml` POSTs to Expo's public push API (`https://exp.host/--/api/v2/push/send`). No Expo credentials are needed on the GitHub side — just the push token.

Two trigger modes:

- `workflow_dispatch` with title/body/doc inputs (for manual testing)
- `repository_dispatch` with `event_type: living-doc-updated` and a `client_payload` (for skills that fire programmatically)

## Project shape

```
mobile/
├── App.tsx                       # Root: providers + navigation
├── index.ts                      # registerRootComponent
├── app.json                      # Expo config (clientId, repo, pages URL)
├── package.json
├── tsconfig.json
└── src/
    ├── theme.ts                  # Colors, radii, spacing, typography
    ├── auth.tsx                  # GitHub device-flow OAuth + SecureStore
    ├── github.ts                 # GitHub API: list docs
    ├── notifications.ts          # Expo push registration
    ├── navigation.tsx            # Tabs + stack
    ├── components.tsx            # DocCard, Pill, EmptyState
    └── screens/
        ├── SignIn.tsx
        ├── Home.tsx              # Docs list
        ├── DocDetail.tsx         # WebView
        ├── Inbox.tsx             # Notifications
        └── Settings.tsx          # Profile + push token
```

## Roadmap

- Native re-render of living docs (no WebView) using the same registry JSON — closer match to the GitHub mobile app feel
- Persistent inbox (SQLite via `expo-sqlite`)
- Multi-repo: let the user pick which repos to follow
- `/living-doc` skill integration: skill runs → workflow dispatches → notification lands
