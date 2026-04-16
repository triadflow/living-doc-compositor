// The GitHub Actions workflow the mobile app writes into connected repos.
// Embedded as a string constant so the app works offline and has a single
// source of truth for the push wiring.
//
// Keep this in sync with .github/workflows/living-doc-notify.yml at the repo
// root (the reference copy). Changing one should change both.
import { DELIVERY_FEED_BRANCH, DELIVERY_FEED_DIR } from './delivery-feed';

export const WORKFLOW_TEMPLATE = `# Living Doc Notify
# Installed by the Living Docs mobile app when you connect this repo.
# Writes a GitHub-backed feed event for the mobile app to sync, and sends an
# Expo push notification when a real device token is available.
#
# Optional repo secret:
#   EXPO_PUSH_TOKEN — optional for Expo push; repo-feed writing does not depend on it.
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

permissions:
  contents: write

jobs:
  deliver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Write repo delivery feed event
        env:
          FEED_BRANCH: ${DELIVERY_FEED_BRANCH}
          FEED_DIR: ${DELIVERY_FEED_DIR}
          REPO: \${{ github.repository }}
          TITLE: \${{ inputs.title || github.event.client_payload.title }}
          BODY: \${{ inputs.body || github.event.client_payload.body }}
          URL: \${{ inputs.url || github.event.client_payload.url }}
          STATUS: \${{ inputs.status || github.event.client_payload.status }}
        run: |
          set -euo pipefail

          EVENT_TIME=\$(date -u +"%Y-%m-%dT%H:%M:%SZ")
          EVENT_ID="\${REPO//\\//-}-\${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}"
          EVENT_FILE="\${EVENT_TIME//:/-}--\${EVENT_ID}.json"
          TMP_EVENT=\$(mktemp)

          jq -n \\
            --arg id "\$EVENT_ID" \\
            --arg title "\$TITLE" \\
            --arg body "\$BODY" \\
            --arg url "\$URL" \\
            --arg status "\$STATUS" \\
            --arg source "\$REPO" \\
            --arg createdAt "\$EVENT_TIME" \\
            --arg repo "\$REPO" \\
            '{
              id: $id,
              title: $title,
              body: $body,
              createdAt: $createdAt,
              repo: $repo,
              source: $source
            }
            + (if $url == "" then {} else { url: $url } end)
            + (if $status == "" then {} else { status: $status } end)' > "\$TMP_EVENT"

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          if git ls-remote --exit-code --heads origin "\$FEED_BRANCH" >/dev/null 2>&1; then
            git fetch origin "\$FEED_BRANCH:\$FEED_BRANCH"
            git checkout "\$FEED_BRANCH"
          else
            git checkout --orphan "\$FEED_BRANCH"
            git rm -rf . >/dev/null 2>&1 || true
            git clean -fdx
          fi

          mkdir -p "\$FEED_DIR"
          cp "\$TMP_EVENT" "\$FEED_DIR/\$EVENT_FILE"

          git add "\$FEED_DIR/\$EVENT_FILE"
          git commit -m "Living Docs feed event \$EVENT_ID"
          git push origin "HEAD:\$FEED_BRANCH"

      - name: Send Expo push
        continue-on-error: true
        env:
          REPO: \${{ github.repository }}
          EXPO_PUSH_TOKEN: \${{ secrets.EXPO_PUSH_TOKEN }}
          TITLE: \${{ inputs.title || github.event.client_payload.title }}
          BODY: \${{ inputs.body || github.event.client_payload.body }}
          URL: \${{ inputs.url || github.event.client_payload.url }}
          STATUS: \${{ inputs.status || github.event.client_payload.status }}
        run: |
          if [ -z "\$EXPO_PUSH_TOKEN" ]; then
            echo "No Expo push token configured; repo feed written without push delivery."
            exit 0
          fi

          case "\$EXPO_PUSH_TOKEN" in
            ExponentPushToken\\[placeholder-*)
              echo "Preview placeholder token configured; skipping Expo push."
              exit 0
              ;;
          esac

          payload=\$(jq -n \\
            --arg to "\$EXPO_PUSH_TOKEN" \\
            --arg title "\$TITLE" \\
            --arg body "\$BODY" \\
            --arg url "\$URL" \\
            --arg status "\$STATUS" \\
            --arg source "\$REPO" \\
            '{
              to: \$to,
              title: \$title,
              body: \$body,
              sound: "default",
              data: (
                { source: $source, repo: $source } |
                (if \$url == "" then . else . + { url: \$url, title: \$title } end) |
                (if \$status == "" then . else . + { status: \$status } end)
              )
            }')

          curl --fail-with-body -sS -X POST https://exp.host/--/api/v2/push/send \\
            -H "Accept: application/json" \\
            -H "Content-Type: application/json" \\
            -d "\$payload"
`;

export const WORKFLOW_PATH = '.github/workflows/living-doc-notify.yml';
