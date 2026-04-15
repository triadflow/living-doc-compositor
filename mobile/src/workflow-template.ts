// The GitHub Actions workflow the mobile app writes into connected repos.
// Embedded as a string constant so the app works offline and has a single
// source of truth for the push wiring.
//
// Keep this in sync with .github/workflows/living-doc-notify.yml at the repo
// root (the reference copy). Changing one should change both.

export const WORKFLOW_TEMPLATE = `# Living Doc Notify
# Installed by the Living Docs mobile app when you connect this repo.
# Sends a push notification to your registered device when a living-doc skill
# (or any caller) dispatches this workflow.
#
# Required repo secret:
#   EXPO_PUSH_TOKEN — the Expo push token from the mobile app's Settings tab.
#
# Triggered by:
#   - workflow_dispatch with title/body/doc inputs (for manual testing)
#   - repository_dispatch with event_type=living-doc-updated (for skills)

name: Living Doc Notify

on:
  workflow_dispatch:
    inputs:
      title:
        description: "Notification title"
        required: true
        type: string
      body:
        description: "Notification body"
        required: true
        type: string
      url:
        description: "URL to open when tapped (rendered doc)"
        required: false
        type: string
      status:
        description: "Optional status label (green, warning, etc.)"
        required: false
        type: string
  repository_dispatch:
    types: [living-doc-updated]

jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - name: Send Expo push
        env:
          EXPO_PUSH_TOKEN: \${{ secrets.EXPO_PUSH_TOKEN }}
          TITLE: \${{ inputs.title || github.event.client_payload.title }}
          BODY: \${{ inputs.body || github.event.client_payload.body }}
          URL: \${{ inputs.url || github.event.client_payload.url }}
          STATUS: \${{ inputs.status || github.event.client_payload.status }}
        run: |
          if [ -z "\$EXPO_PUSH_TOKEN" ]; then
            echo "EXPO_PUSH_TOKEN secret is not configured; add it via the mobile app."
            exit 1
          fi

          payload=\$(jq -n \\
            --arg to "\$EXPO_PUSH_TOKEN" \\
            --arg title "\$TITLE" \\
            --arg body "\$BODY" \\
            --arg url "\$URL" \\
            --arg status "\$STATUS" \\
            '{
              to: \$to,
              title: \$title,
              body: \$body,
              sound: "default",
              data: (
                {} |
                (if \$url == "" then . else . + { url: \$url, title: \$title } end) |
                (if \$status == "" then . else . + { status: \$status } end)
              )
            }')

          curl -sS -X POST https://exp.host/--/api/v2/push/send \\
            -H "Accept: application/json" \\
            -H "Content-Type: application/json" \\
            -d "\$payload"
`;

export const WORKFLOW_PATH = '.github/workflows/living-doc-notify.yml';
