#!/usr/bin/env bash
# gen-web-ui-signing-key.sh
# ──────────────────────────────────────────────────────────────────────────
# Generate an Ed25519 keypair for signing web-UI update manifests.
#
# Usage:
#   bash scripts/gen-web-ui-signing-key.sh
#
# What this does:
#   1. Generates a new Ed25519 private key and writes it to ./web-ui-signing.key
#   2. Derives the SPKI public key PEM and prints it to stdout.
#   3. Prints instructions for using the keys.
#
# After running this script:
#   • Copy the PUBLIC KEY block printed below into WEB_UI_PUBLIC_KEY in
#     packages/viewer/electron/updater/contract.ts
#   • Store the contents of ./web-ui-signing.key as the GitHub Actions secret
#     named WEB_UI_SIGNING_KEY (Settings → Secrets and variables → Actions).
#   • ⚠️  DO NOT commit web-ui-signing.key to git — it is the private key.
#         Add it to .gitignore if it isn't already.
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

PRIVATE_KEY_FILE="web-ui-signing.key"
PUBLIC_KEY_FILE="web-ui-signing.pub"

# ── 1. Generate private key ──────────────────────────────────────────────
echo "Generating Ed25519 private key → ${PRIVATE_KEY_FILE} ..."
openssl genpkey -algorithm Ed25519 -out "${PRIVATE_KEY_FILE}"

# ── 2. Derive public key (SPKI PEM) ─────────────────────────────────────
openssl pkey -in "${PRIVATE_KEY_FILE}" -pubout -out "${PUBLIC_KEY_FILE}"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  PUBLIC KEY — paste this into WEB_UI_PUBLIC_KEY in contract.ts"
echo "════════════════════════════════════════════════════════════════════"
cat "${PUBLIC_KEY_FILE}"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  NEXT STEPS"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "  1. Open packages/viewer/electron/updater/contract.ts"
echo "     Replace the placeholder WEB_UI_PUBLIC_KEY value with the"
echo "     PUBLIC KEY block printed above (include the header/footer lines)."
echo ""
echo "  2. Store the PRIVATE KEY as a GitHub Actions secret:"
echo "     → Repository Settings → Secrets and variables → Actions"
echo "     → New repository secret"
echo "     → Name: WEB_UI_SIGNING_KEY"
echo "     → Value: contents of ./${PRIVATE_KEY_FILE}"
echo "     (Use: cat ${PRIVATE_KEY_FILE} | pbcopy  or  xclip -sel clip)"
echo ""
echo "  3. ⚠️  IMPORTANT — DO NOT commit ${PRIVATE_KEY_FILE} to git."
echo "     The private key must stay off of source control."
echo "     Add it to .gitignore right now if it is not already listed:"
echo "       echo '${PRIVATE_KEY_FILE}' >> .gitignore"
echo "       echo '${PUBLIC_KEY_FILE}' >> .gitignore"
echo ""
echo "  The CI signing workflow reads \${{ secrets.WEB_UI_SIGNING_KEY }}"
echo "  and uses: openssl pkeyutl -sign -inkey <(echo \"\$WEB_UI_SIGNING_KEY\")"
echo "            -rawin -in update-manifest.json | base64 > update-manifest.json.sig"
echo ""

rm -f "${PUBLIC_KEY_FILE}"
