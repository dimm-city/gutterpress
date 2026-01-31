#!/bin/bash
# Vendor Vivliostyle Viewer into print-md assets
#
# This script downloads the Vivliostyle Viewer distribution and
# extracts it to src/assets/vendor/vivliostyle/

set -e

VIVLIOSTYLE_VERSION="${VIVLIOSTYLE_VERSION:-2.31.4}"
VENDOR_DIR="src/assets/vendor/vivliostyle"
TEMP_DIR="$(mktemp -d)"

echo "Vendoring Vivliostyle Viewer v${VIVLIOSTYLE_VERSION}..."

# Clean up on exit
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Create vendor directory
mkdir -p "$VENDOR_DIR"

# Download from npm (unpkg)
echo "Downloading from unpkg.com..."
VIEWER_URL="https://unpkg.com/@vivliostyle/viewer@${VIVLIOSTYLE_VERSION}/lib/"

# Download the main files
echo "Downloading viewer files..."

# The lib directory contains the viewer
curl -sL "https://unpkg.com/@vivliostyle/viewer@${VIVLIOSTYLE_VERSION}/lib/index.html" -o "$VENDOR_DIR/index.html"
curl -sL "https://unpkg.com/@vivliostyle/viewer@${VIVLIOSTYLE_VERSION}/lib/vivliostyle-viewer.js" -o "$VENDOR_DIR/vivliostyle-viewer.js"

# Download resources directory (contains navigator, settings panel, etc.)
mkdir -p "$VENDOR_DIR/resources"

# Try to get resource files (some may not exist in all versions)
for file in vivliostyle-viewport.css viewer-ui.css; do
    curl -sL "https://unpkg.com/@vivliostyle/viewer@${VIVLIOSTYLE_VERSION}/lib/resources/${file}" -o "$VENDOR_DIR/resources/${file}" 2>/dev/null || true
done

# Also download from jsdelivr as fallback for all assets
echo "Downloading additional assets from jsdelivr..."
mkdir -p "$TEMP_DIR/viewer"
cd "$TEMP_DIR"

# Download the tarball and extract
npm pack @vivliostyle/viewer@${VIVLIOSTYLE_VERSION} 2>/dev/null || {
    echo "npm pack failed, trying direct download..."
    curl -sL "https://registry.npmjs.org/@vivliostyle/viewer/-/viewer-${VIVLIOSTYLE_VERSION}.tgz" -o vivliostyle.tgz
    tar -xzf vivliostyle.tgz
}

# Check if we got the package
if [ -d "package" ]; then
    echo "Extracting viewer distribution..."
    if [ -d "package/lib" ]; then
        cp -r package/lib/* "$OLDPWD/$VENDOR_DIR/"
    fi
fi

cd "$OLDPWD"

# Create a version file for tracking
echo "$VIVLIOSTYLE_VERSION" > "$VENDOR_DIR/VERSION"

# Verify the installation
if [ -f "$VENDOR_DIR/index.html" ] && [ -f "$VENDOR_DIR/vivliostyle-viewer.js" ]; then
    echo "✓ Vivliostyle Viewer v${VIVLIOSTYLE_VERSION} vendored successfully"
    echo "  Location: $VENDOR_DIR"
    ls -la "$VENDOR_DIR"
else
    echo "✗ Error: Vivliostyle Viewer installation incomplete"
    echo "  Missing required files in $VENDOR_DIR"
    exit 1
fi
