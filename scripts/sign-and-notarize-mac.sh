#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-}"
CHANNEL="${X2MD_RELEASE_CHANNEL:-beta}"
DRY_RUN="${X2MD_SIGN_DRY_RUN:-0}"
LOG_FILE="${X2MD_COMMAND_LOG:-}"

if [[ -z "$APP_PATH" ]]; then
  echo "Usage: scripts/sign-and-notarize-mac.sh <X2MD.app>" >&2
  exit 2
fi

required=(MAC_CERTIFICATE_P12_BASE64 MAC_CERTIFICATE_PASSWORD MAC_SIGN_IDENTITY APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD)
missing=()
for name in "${required[@]}"; do [[ -n "${!name:-}" ]] || missing+=("$name"); done
if ((${#missing[@]})); then
  if [[ "$CHANNEL" == "stable" ]]; then
    echo "Stable signing credentials missing: ${missing[*]}" >&2
    exit 1
  fi
  echo "Unsigned ${CHANNEL} build: signing credentials are not configured"
  exit 0
fi

run() {
  local rendered
  printf -v rendered '%q ' "$@"
  [[ -z "$LOG_FILE" ]] || printf '%s\n' "${rendered% }" >> "$LOG_FILE"
  if [[ -n "${X2MD_FAKE_FAIL_MATCH:-}" && "$rendered" == *"$X2MD_FAKE_FAIL_MATCH"* ]]; then return 42; fi
  [[ "$DRY_RUN" == "1" ]] || "$@"
}

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/x2md-notary.XXXXXX")"
KEYCHAIN="$WORK_DIR/signing.keychain-db"
P12="$WORK_DIR/certificate.p12"
NOTARY_ZIP="$WORK_DIR/X2MD-notary.zip"
KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(openssl rand -hex 16)}"
cleanup() {
  if [[ "$DRY_RUN" != "1" ]]; then security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

if [[ "$DRY_RUN" == "1" ]]; then : > "$P12"; else printf '%s' "$MAC_CERTIFICATE_P12_BASE64" | openssl base64 -d -A -out "$P12"; fi
run security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
run security set-keychain-settings -lut 21600 "$KEYCHAIN"
run security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
run security import "$P12" -k "$KEYCHAIN" -P "$MAC_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
run security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
run codesign --force --deep --options runtime --timestamp --keychain "$KEYCHAIN" --sign "$MAC_SIGN_IDENTITY" "$APP_PATH"
run codesign --verify --deep --strict --verbose=2 "$APP_PATH"
run ditto -c -k --keepParent "$APP_PATH" "$NOTARY_ZIP"
run xcrun notarytool submit "$NOTARY_ZIP" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
run xcrun stapler staple "$APP_PATH"
run xcrun stapler validate "$APP_PATH"
run codesign --verify --deep --strict --verbose=2 "$APP_PATH"
run spctl --assess --type execute --verbose=2 "$APP_PATH"
echo "Mac signing and notarization pipeline completed for $APP_PATH"
