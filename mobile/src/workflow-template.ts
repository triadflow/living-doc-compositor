// The GitHub Actions workflow the mobile app writes into connected repos.
// Embedded as a string constant so the app works offline and has a single
// source of truth for the push wiring.
//
// Keep this in sync with .github/workflows/living-doc-notify.yml at the repo
// root (the reference copy). Changing one should change both.
import { DELIVERY_FEED_BRANCH, DELIVERY_FEED_DIR } from './delivery-feed';
import { DELIVERY_MANIFEST_PATH } from './delivery-manifest';
import { WORKFLOW_GROUNDED_EVENTS_SCRIPT } from './workflow-grounded-generator';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const WORKFLOW_GROUNDED_EVENTS_SCRIPT_BASE64 = encodeAsciiBase64(WORKFLOW_GROUNDED_EVENTS_SCRIPT);

function encodeAsciiBase64(value: string): string {
  let output = '';

  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index) & 0xff;
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) & 0xff : NaN;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) & 0xff : NaN;
    const chunk = (first << 16) | ((Number.isNaN(second) ? 0 : second) << 8) | (Number.isNaN(third) ? 0 : third);

    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += Number.isNaN(second) ? '=' : BASE64_ALPHABET[(chunk >> 6) & 63];
    output += Number.isNaN(third) ? '=' : BASE64_ALPHABET[chunk & 63];
  }

  return output;
}

export const WORKFLOW_TEMPLATE = `# Living Doc Notify
# Installed by the Living Docs mobile app when you connect this repo.
# Writes a GitHub-backed feed event for the mobile app to sync, and sends an
# Expo push notification when a real device token is available.
#
# Optional repo secret:
#   EXPO_PUSH_TOKEN — optional for Expo push; repo-feed writing does not depend on it.
#
# Repo-local manifest:
#   ${DELIVERY_MANIFEST_PATH} — minimal mirror of delivery-critical living-doc
#   metadata. The workflow reads this file on push so changed JSON or HTML paths
#   can be resolved into doc ids, titles, and public URLs without depending on a
#   central local registry.
#   When no explicit grounded artifact is present, the workflow heuristically
#   derives structured block events from before/after living-doc JSON.
#
# Triggered by:
#   - push on the default branch when manifest-backed doc paths change
#   - workflow_dispatch with legacy title/body inputs or eventJson (for manual testing)
#   - repository_dispatch with event_type=living-doc-updated (for skills or richer event senders)

name: Living Doc Notify

on:
  push:
  workflow_dispatch:
    inputs:
      docId:
        description: "Optional doc id"
        required: false
        type: string
      title:
        description: "Notification title"
        required: false
        type: string
      body:
        description: "Notification body"
        required: false
        type: string
      url:
        description: "URL to open when tapped (rendered doc)"
        required: false
        type: string
      status:
        description: "Optional status label (green, warning, etc.)"
        required: false
        type: string
      eventJson:
        description: "Optional JSON object or array for richer grounded/block events"
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

      - name: Collect delivery events
        id: collect-events
        env:
          EVENT_NAME: \${{ github.event_name }}
          REPO: \${{ github.repository }}
          REF_NAME: \${{ github.ref_name }}
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch }}
          BEFORE_SHA: \${{ github.event.before }}
          MANIFEST_PATH: ${DELIVERY_MANIFEST_PATH}
          DOC_ID: \${{ inputs.docId || github.event.client_payload.docId }}
          TITLE: \${{ inputs.title || github.event.client_payload.title }}
          BODY: \${{ inputs.body || github.event.client_payload.body }}
          URL: \${{ inputs.url || github.event.client_payload.url }}
          STATUS: \${{ inputs.status || github.event.client_payload.status }}
          EVENT_JSON: \${{ inputs.eventJson || github.event.client_payload.eventJson }}
          CLIENT_PAYLOAD_JSON: \${{ toJson(github.event.client_payload) }}
        run: |
          set -euo pipefail

          EVENTS_FILE="\$RUNNER_TEMP/living-doc-events.json"
          CHANGED_FILE="\$RUNNER_TEMP/living-doc-changed.txt"

          normalize_events() {
            jq --arg repo "\$REPO" '
              def event_list:
                if . == null then []
                elif type == "array" then .
                elif type == "object" then [.] else [] end;
              event_list
              | map(select(type == "object"))
              | map(. + {
                  repo: (.repo // $repo),
                  source: (.source // .repo // $repo)
                })
            '
          }

          case "\$EVENT_NAME" in
            workflow_dispatch|repository_dispatch)
              if [ -n "\$EVENT_JSON" ]; then
                printf '%s' "\$EVENT_JSON" | normalize_events > "\$EVENTS_FILE"
              elif [ "\$EVENT_NAME" = "repository_dispatch" ] && printf '%s' "\$CLIENT_PAYLOAD_JSON" | jq -e '(.events? // .event? // null) != null' >/dev/null; then
                printf '%s' "\$CLIENT_PAYLOAD_JSON" | jq '(.events? // .event?)' | normalize_events > "\$EVENTS_FILE"
              elif [ -n "\$TITLE" ] || [ -n "\$BODY" ]; then
                jq -n \\
                  --arg docId "\$DOC_ID" \\
                  --arg title "\$TITLE" \\
                  --arg body "\$BODY" \\
                  --arg url "\$URL" \\
                  --arg status "\$STATUS" \\
                  --arg repo "\$REPO" \\
                  '[{
                    schemaVersion: "2026-04-19",
                    kind: "manual-note",
                    title: ($title | if . == "" then "Living Doc update" else . end),
                    body: ($body | if . == "" then "Manual feed event triggered without body." else . end),
                    repo: $repo,
                    source: $repo
                  }
                  + (if $docId == "" then {} else { docId: $docId } end)
                  + (if $url == "" then {} else { url: $url } end)
                  + (if $status == "" then {} else {
                      status: $status,
                      transition: {
                        label: $status,
                        to: $status,
                        tone: (
                          if ($status | ascii_downcase | test("done|ready|green|resolved|success")) then "success"
                          elif ($status | ascii_downcase | test("blocked|red|broken|error|fail")) then "danger"
                          elif ($status | ascii_downcase | test("warn|review|partial|preview")) then "warning"
                          else "accent" end
                        )
                      }
                    } end)]' > "\$EVENTS_FILE"
              else
                echo '[]' > "\$EVENTS_FILE"
              fi
              ;;
            push)
              if [ "\$REF_NAME" != "\$DEFAULT_BRANCH" ]; then
                echo '[]' > "\$EVENTS_FILE"
              elif [ ! -f "\$MANIFEST_PATH" ]; then
                echo '[]' > "\$EVENTS_FILE"
              else
                if [ -n "\$BEFORE_SHA" ] && [ "\$BEFORE_SHA" != "0000000000000000000000000000000000000000" ]; then
                  git diff --name-only "\$BEFORE_SHA" "\$GITHUB_SHA" > "\$CHANGED_FILE"
                else
                  git diff-tree --no-commit-id --name-only -r "\$GITHUB_SHA" > "\$CHANGED_FILE"
                fi

                printf '%s' '${WORKFLOW_GROUNDED_EVENTS_SCRIPT_BASE64}' | base64 --decode > "\$RUNNER_TEMP/living-doc-grounded-events.mjs"

                node "\$RUNNER_TEMP/living-doc-grounded-events.mjs" \\
                  "\$MANIFEST_PATH" \\
                  "\$CHANGED_FILE" \\
                  "\$BEFORE_SHA" \\
                  "\$GITHUB_SHA" \\
                  "\$REPO" > "\$EVENTS_FILE"
              fi
              ;;
            *)
              echo '[]' > "\$EVENTS_FILE"
              ;;
          esac

          echo "count=\$(jq 'length' "\$EVENTS_FILE")" >> "\$GITHUB_OUTPUT"
          echo "path=\$EVENTS_FILE" >> "\$GITHUB_OUTPUT"

      - name: Write repo delivery feed events
        if: \${{ steps.collect-events.outputs.count != '0' }}
        env:
          EVENTS_FILE: \${{ steps.collect-events.outputs.path }}
          FEED_BRANCH: ${DELIVERY_FEED_BRANCH}
          FEED_DIR: ${DELIVERY_FEED_DIR}
          REPO: \${{ github.repository }}
        run: |
          set -euo pipefail

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

          index=0
          jq -c '.[]' "\$EVENTS_FILE" | while IFS= read -r event; do
            index=\$((index + 1))
            event_time=\$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            event_id="\${REPO//\\//-}-\${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}-\${index}"
            event_file="\${event_time//:/-}--\${event_id}.json"

            printf '%s' "\$event" | jq \\
              --arg id "\$event_id" \\
              --arg createdAt "\$event_time" \\
              --arg repo "\$REPO" \\
              --arg source "\$REPO" \\
              '. + {
                id: $id,
                createdAt: $createdAt,
                repo: (.repo // $repo),
                source: (.source // $source)
              }' > "\$FEED_DIR/\$event_file"

            git add "\$FEED_DIR/\$event_file"
          done

          if git diff --cached --quiet; then
            echo "No feed events staged."
            exit 0
          fi

          git commit -m "Living Docs feed events \${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}"
          git push origin "HEAD:\$FEED_BRANCH"

      - name: Send Expo push
        if: \${{ steps.collect-events.outputs.count != '0' }}
        continue-on-error: true
        env:
          EVENTS_FILE: \${{ steps.collect-events.outputs.path }}
          EXPO_PUSH_TOKEN: \${{ secrets.EXPO_PUSH_TOKEN }}
        run: |
          set -euo pipefail

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

          jq -c '.[]' "\$EVENTS_FILE" | while IFS= read -r event; do
            payload=\$(printf '%s' "\$event" | jq -c \\
              --arg to "\$EXPO_PUSH_TOKEN" \\
              '{
                to: $to,
                title: .title,
                body: .body,
                sound: "default",
                data: (
                  { source: (.source // .repo), repo: (.repo // .source) }
                  + (if (.url // "") == "" then {} else { url: .url, title: (.docTitle // .title) } end)
                  + (if (.status // "") == "" then {} else { status: .status } end)
                  + (if (.docId // "") == "" then {} else { docId: .docId } end)
                  + (if (.docTitle // "") == "" then {} else { docTitle: .docTitle } end)
                  + (if (.schemaVersion // "") == "" then {} else { schemaVersion: .schemaVersion } end)
                  + (if (.kind // "") == "" then {} else { eventKind: .kind } end)
                  + (if (.audience // "") == "" then {} else { audience: .audience } end)
                  + (if (.transition | type) != "object" then {} else { transition: .transition } end)
                  + (if (.intent | type) != "object" then {} else { intent: .intent } end)
                  + (if (.grounding | type) != "object" then {} else { grounding: .grounding } end)
                  + (if ((.evidence // []) | length) == 0 then {} else { evidence: .evidence } end)
                  + (if ((.openQuestions // []) | length) == 0 then {} else { openQuestions: .openQuestions } end)
                  + (if ((.blocks // []) | length) == 0 then {} else { blocks: .blocks } end)
                )
              }')

            curl --fail-with-body -sS -X POST https://exp.host/--/api/v2/push/send \\
              -H "Accept: application/json" \\
              -H "Content-Type: application/json" \\
              -d "\$payload"
          done
`;

export const WORKFLOW_PATH = '.github/workflows/living-doc-notify.yml';
