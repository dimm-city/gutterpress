#!/usr/bin/env bash
# Behavioral test for install.sh's checksum verification.
#
# Sources the installer's functions (minus the `main` invocation) and stubs the
# two network-touching helpers, so verify_checksum can be exercised offline.
# Run directly, or via packages/cli/src/installer-checksum.test.ts.
#
# The policy under test: verification is the default, a MISMATCH is always
# fatal, and an UNAVAILABLE hash warns but still installs (so releases published
# before SHA256SUMS.txt existed stay installable).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Strip the trailing `main "$@"` call so sourcing defines functions only.
sed '/^main /d' "$INSTALLER" > "$TMP/lib.sh"
# shellcheck disable=SC1090
source "$TMP/lib.sh"

pass=0
fail=0
check() {
    local name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "  PASS  $name"
        pass=$((pass + 1))
    else
        echo "  FAIL  $name (expected '$expected', got '$actual')"
        fail=$((fail + 1))
    fi
}

warn_state() { [ -n "$PRINTMD_UNVERIFIED" ] && echo set || echo empty; }

# ---- fixtures --------------------------------------------------------------

PRINTMD_TAG="v1.2.3"
PRINTMD_ASSET="print-md-cli-linux-x64"
printf 'hello print-md\n' > "$TMP/binary"
REAL_HASH="$(sha256sum "$TMP/binary" | awk '{print $1}')"

STUB_MODE=""
STUB_SUMS=""
STUB_CURL_FAILS=""

# Stub the release-JSON lookup and the network fetch.
asset_url_by_name() {
    case "$1" in
        SHA256SUMS.txt)
            if [ "$STUB_MODE" = "no-sums" ]; then printf ''; else printf 'https://example/sums'; fi
            ;;
        *) printf 'https://example/asset' ;;
    esac
}
gh_curl() {
    if [ -n "$STUB_CURL_FAILS" ]; then return 1; fi
    printf '%s' "$STUB_SUMS"
}

# Must run in the CURRENT shell, not a $(...) subshell — verify_checksum
# communicates the skip reason by assigning PRINTMD_UNVERIFIED, and a subshell
# would discard it. The installer calls it via `if ! verify_checksum`, which
# likewise stays in the current shell.
RC=""
run_verify() {
    set +e
    verify_checksum "$TMP/binary" >/dev/null 2>&1
    RC=$?
    set -e
}

echo "verify_checksum:"

# 1. Hash present and matching -> verified, no warning.
STUB_MODE=""; STUB_CURL_FAILS=""
STUB_SUMS="$REAL_HASH  $PRINTMD_ASSET"
run_verify; check "matching hash exits 0" "0" "$RC"
check "matching hash records no warning" "empty" "$(warn_state)"

# 2. Hash present and MISMATCHED -> fatal, nothing gets installed.
STUB_SUMS="0000000000000000000000000000000000000000000000000000000000000000  $PRINTMD_ASSET"
run_verify; check "mismatched hash exits 1 (fatal)" "1" "$RC"

# 3. Release publishes no SHA256SUMS.txt (pre-checksum release) -> warn, continue.
STUB_MODE="no-sums"
run_verify; check "absent manifest exits 0 (continues)" "0" "$RC"
check "absent manifest records warning" "set" "$(warn_state)"

# 4. Manifest exists but does not list our asset -> warn, continue.
STUB_MODE=""
STUB_SUMS="$REAL_HASH  some-other-asset"
run_verify; check "unlisted asset exits 0 (continues)" "0" "$RC"
check "unlisted asset records warning" "set" "$(warn_state)"

# 5. Manifest download fails -> warn, continue.
STUB_SUMS="$REAL_HASH  $PRINTMD_ASSET"
STUB_CURL_FAILS="1"
run_verify; check "manifest fetch failure exits 0 (continues)" "0" "$RC"
check "manifest fetch failure records warning" "set" "$(warn_state)"
STUB_CURL_FAILS=""

# 6. Uppercase hash in the manifest still matches (compare is case-insensitive).
STUB_SUMS="$(printf '%s' "$REAL_HASH" | tr 'a-f' 'A-F')  $PRINTMD_ASSET"
run_verify; check "uppercase manifest hash exits 0" "0" "$RC"
check "uppercase manifest hash records no warning" "empty" "$(warn_state)"

# 7. Multi-line manifest selects the row for our asset, not the first row.
STUB_SUMS="$(printf '%s  other-asset\n%s  %s\n%s  third-asset' \
    "0000000000000000000000000000000000000000000000000000000000000000" \
    "$REAL_HASH" "$PRINTMD_ASSET" \
    "1111111111111111111111111111111111111111111111111111111111111111")"
run_verify; check "multi-line manifest selects correct row" "0" "$RC"
check "multi-line manifest records no warning" "empty" "$(warn_state)"

echo ""
echo "sha256_of_file:"
check "computes correct sha256" "$REAL_HASH" "$(sha256_of_file "$TMP/binary")"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
