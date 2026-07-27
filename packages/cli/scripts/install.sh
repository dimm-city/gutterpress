#!/usr/bin/env bash
# print-md installer for Linux and macOS
#
# Downloads the standalone binary for the current platform from GitHub
# Releases and drops it in ~/.local/bin. No bun, node, or git required.
#
#   curl -fsSL https://raw.githubusercontent.com/dimm-city/print-md/main/packages/cli/scripts/install.sh | bash
#
# Optional environment variables:
#   PRINTMD_VERSION  override the version to install (e.g. v0.2.0-beta.5)
#   GITHUB_TOKEN     auth token (only needed while the repo is private)
#   PRINTMD_PREFIX   install dir override (default: ~/.local/bin)

set -euo pipefail

REPO="dimm-city/print-md"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
PRINTMD_VERSION="${PRINTMD_VERSION:-}"
PRINTMD_PREFIX="${PRINTMD_PREFIX:-$HOME/.local/bin}"

# Name of the published checksum manifest. Written by
# tools/prepare-release-assets.mjs as `<sha256>  <asset name>` lines.
PRINTMD_CHECKSUM_ASSET="SHA256SUMS.txt"

# Set by verify_checksum() to the reason verification was skipped, and empty
# when the download was actually verified. main() reads it to repeat the
# warning at the end of the run.
PRINTMD_UNVERIFIED=""

# ---- output helpers --------------------------------------------------------

print_success() { printf '\033[0;32m[OK]\033[0m %s\n' "$1"; }
print_info()    { printf '\033[0;36m[INFO]\033[0m %s\n' "$1"; }
print_error()   { printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2; }
print_step()    { printf '\n\033[0;33m>>> %s\033[0m\n' "$1"; }

# ---- platform detection ----------------------------------------------------

detect_platform() {
    local uname_s uname_m os arch
    uname_s="$(uname -s)"
    uname_m="$(uname -m)"

    case "$uname_s" in
        Linux*)  os=linux ;;
        Darwin*) os=macos ;;
        *) print_error "Unsupported OS: $uname_s"; return 1 ;;
    esac

    case "$uname_m" in
        x86_64|amd64) arch=x64 ;;
        arm64|aarch64) arch=arm64 ;;
        *) print_error "Unsupported architecture: $uname_m"; return 1 ;;
    esac

    PRINTMD_OS="$os"
    PRINTMD_ARCH="$arch"
    # Must match the release.yml build-cli matrix `artifact` names. The `-cli`
    # infix distinguishes these standalone CLI binaries from the
    # print-md-viewer-* desktop assets in the same release.
    PRINTMD_ASSET="print-md-cli-${os}-${arch}"
}

# ---- curl helpers ----------------------------------------------------------
#
# All GitHub fetches go through `gh_curl` so the same code path covers public
# and private repos: when GITHUB_TOKEN is set, the token is sent on the
# Authorization header (which is the only path that works for private repos).

gh_curl() {
    local accept="${1:-application/vnd.github+json}"
    shift
    local args=(-fsSL -H "Accept: $accept" -H "X-GitHub-Api-Version: 2022-11-28")
    if [ -n "$GITHUB_TOKEN" ]; then
        args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
    fi
    curl "${args[@]}" "$@"
}

gh_download() {
    # Like gh_curl but for binary downloads — shows a progress bar.
    local accept="${1:-application/octet-stream}"
    shift
    local args=(-fL --progress-bar -H "Accept: $accept")
    if [ -n "$GITHUB_TOKEN" ]; then
        args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
    fi
    curl "${args[@]}" "$@"
}

# ---- release resolution ----------------------------------------------------
#
# Fetch the latest release JSON. /releases/latest skips prereleases, so when
# it 404s we fall back to /releases?per_page=1 which returns whatever's most
# recent (stable or prerelease).

fetch_release() {
    local url
    if [ -n "$PRINTMD_VERSION" ]; then
        local tag="${PRINTMD_VERSION#v}"
        tag="v${tag}"
        url="https://api.github.com/repos/${REPO}/releases/tags/${tag}"
        if ! PRINTMD_RELEASE_JSON="$(gh_curl '' "$url" 2>&1)"; then
            print_error "Could not fetch release $tag from $REPO"
            return 1
        fi
    else
        url="https://api.github.com/repos/${REPO}/releases/latest"
        if ! PRINTMD_RELEASE_JSON="$(gh_curl '' "$url" 2>/dev/null)"; then
            url="https://api.github.com/repos/${REPO}/releases?per_page=1"
            if ! PRINTMD_RELEASE_JSON="$(gh_curl '' "$url" 2>&1)"; then
                print_error "Could not fetch latest release from $REPO"
                if [ -z "$GITHUB_TOKEN" ]; then
                    print_info "If the repository is private, set GITHUB_TOKEN."
                fi
                return 1
            fi
            # /releases returns an array — take the first element.
            PRINTMD_RELEASE_JSON="${PRINTMD_RELEASE_JSON#[}"
            PRINTMD_RELEASE_JSON="${PRINTMD_RELEASE_JSON%]}"
        fi
    fi

    PRINTMD_TAG="$(printf '%s' "$PRINTMD_RELEASE_JSON" \
        | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"

    if [ -z "$PRINTMD_TAG" ]; then
        print_error "Could not parse release tag from GitHub response"
        return 1
    fi
}

# Print the API download URL for a named asset in the resolved release JSON,
# or nothing when the release has no such asset. Uses python3 if available
# (cleaner) or grep otherwise. Callers decide whether "absent" is fatal.
asset_url_by_name() {
    local name="$1"
    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$PRINTMD_RELEASE_JSON" \
            | python3 -c "
import json, sys
data = json.load(sys.stdin)
asset_name = sys.argv[1]
for a in data.get('assets', []):
    if a.get('name') == asset_name:
        print(a.get('url', ''))
        break
" "$name"
    else
        # Locate the asset block whose "name" matches and pull its API "url".
        printf '%s' "$PRINTMD_RELEASE_JSON" \
            | tr '\n' ' ' \
            | grep -oE '\{[^{}]*"name"[^{}]*"'"$name"'"[^{}]*\}' \
            | head -1 \
            | grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' \
            | head -1 \
            | sed -E 's/.*"url"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
    fi
}

# Find the download URL for our platform's asset. Missing asset is fatal.
resolve_asset_url() {
    PRINTMD_ASSET_URL="$(asset_url_by_name "$PRINTMD_ASSET")"

    if [ -z "$PRINTMD_ASSET_URL" ]; then
        print_error "Release $PRINTMD_TAG has no asset named $PRINTMD_ASSET"
        return 1
    fi
}

# ---- checksum verification -------------------------------------------------

to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Print the sha256 of a file using whichever tool this system has, or fail.
sha256_of_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$file" | awk '{print $NF}'
    else
        return 1
    fi
}

# Verify a downloaded file against the release's published SHA256SUMS.txt.
#
# Policy: verification is the default, and a MISMATCH is always fatal — a file
# whose hash disagrees with the release manifest is never installed. When the
# hash is simply unavailable (the release predates SHA256SUMS.txt, the manifest
# doesn't list this asset, or the machine has no sha256 tool) we warn and
# continue, so installing an older release still works. Every skip records its
# reason in PRINTMD_UNVERIFIED, which main() reprints at the end of the run
# where it cannot scroll by unnoticed.
verify_checksum() {
    local file="$1"
    PRINTMD_UNVERIFIED=""

    print_step "Verifying download..."

    local checksum_url
    checksum_url="$(asset_url_by_name "$PRINTMD_CHECKSUM_ASSET")"
    if [ -z "$checksum_url" ]; then
        PRINTMD_UNVERIFIED="release $PRINTMD_TAG does not publish $PRINTMD_CHECKSUM_ASSET"
        print_info "This release publishes no $PRINTMD_CHECKSUM_ASSET — cannot verify."
        return 0
    fi

    local sums
    if ! sums="$(gh_curl application/octet-stream "$checksum_url" 2>/dev/null)"; then
        PRINTMD_UNVERIFIED="could not download $PRINTMD_CHECKSUM_ASSET"
        print_info "Could not download $PRINTMD_CHECKSUM_ASSET — cannot verify."
        return 0
    fi

    # Lines are `<sha256>  <asset name>`; awk splits on whitespace.
    local expected
    expected="$(printf '%s\n' "$sums" \
        | awk -v want="$PRINTMD_ASSET" '$2 == want { print $1; exit }')"
    if [ -z "$expected" ]; then
        PRINTMD_UNVERIFIED="$PRINTMD_CHECKSUM_ASSET does not list $PRINTMD_ASSET"
        print_info "$PRINTMD_ASSET is not listed in $PRINTMD_CHECKSUM_ASSET — cannot verify."
        return 0
    fi

    local actual
    if ! actual="$(sha256_of_file "$file")"; then
        PRINTMD_UNVERIFIED="no sha256 tool found (need sha256sum, shasum, or openssl)"
        print_info "No sha256 tool on this system — cannot verify."
        return 0
    fi

    if [ "$(to_lower "$actual")" != "$(to_lower "$expected")" ]; then
        print_error "Checksum mismatch for $PRINTMD_ASSET"
        print_error "  expected: $expected"
        print_error "  actual:   $actual"
        print_error "Refusing to install: the download is corrupt or has been tampered with."
        return 1
    fi

    print_success "Checksum verified against $PRINTMD_CHECKSUM_ASSET"
}

# ---- install steps ---------------------------------------------------------

install_binary() {
    print_step "Downloading print-md $PRINTMD_TAG ($PRINTMD_OS/$PRINTMD_ARCH)..."

    mkdir -p "$PRINTMD_PREFIX"
    PRINTMD_BIN="$PRINTMD_PREFIX/print-md"
    local tmp="$PRINTMD_BIN.download"

    if ! gh_download application/octet-stream -o "$tmp" "$PRINTMD_ASSET_URL"; then
        rm -f "$tmp"
        print_error "Failed to download binary"
        return 1
    fi

    # Verify before the binary is ever moved into place or made executable, so
    # a mismatched download is discarded rather than installed.
    if ! verify_checksum "$tmp"; then
        rm -f "$tmp"
        return 1
    fi

    chmod +x "$tmp"
    mv -f "$tmp" "$PRINTMD_BIN"
    print_success "Installed binary to $PRINTMD_BIN"
}

verify_install() {
    print_step "Verifying installation..."
    local version
    if ! version="$("$PRINTMD_BIN" --version 2>&1)"; then
        print_error "print-md installed but failed to run"
        printf '%s\n' "$version" >&2
        return 1
    fi
    print_success "print-md is working! ($version)"
}

PRINTMD_PATH_MARKER_BEGIN="# >>> print-md installer >>>"
PRINTMD_PATH_MARKER_END="# <<< print-md installer <<<"

# Write (or rewrite) the print-md PATH block in a single rc file. Any existing
# block between our markers is stripped first, so re-installs — even with a
# changed PRINTMD_PREFIX — replace the old entry instead of stacking a new one.
update_rc_path_block() {
    local rc="$1" line="$2" tmp
    mkdir -p "$(dirname "$rc")"
    [ -f "$rc" ] || : > "$rc"
    tmp="$(mktemp)"
    awk -v b="$PRINTMD_PATH_MARKER_BEGIN" -v e="$PRINTMD_PATH_MARKER_END" '
        $0 == b { skip = 1; next }
        $0 == e { skip = 0; next }
        !skip   { print }
    ' "$rc" > "$tmp"
    {
        printf '%s\n' "$PRINTMD_PATH_MARKER_BEGIN"
        printf '%s\n' "$line"
        printf '%s\n' "$PRINTMD_PATH_MARKER_END"
    } >> "$tmp"
    mv "$tmp" "$rc"
}

# Add the install dir to PATH in the rc files the user's shell actually sources.
# $SHELL is the login shell, which often differs from the interactive shell and
# from which rc file gets read (notably bash on macOS reads .bash_profile/
# .profile for the login shells Terminal opens, not .bashrc), so we update the
# realistic set rather than a single guessed file.
ensure_path() {
    case ":$PATH:" in
        *":$PRINTMD_PREFIX:"*) return 0 ;;
    esac

    local line os
    os="$(uname -s)"
    local -a targets=()
    case "${SHELL:-}" in
        */fish)
            # Single-quoted format string keeps $PATH literal so fish expands it.
            line=$(printf 'set -gx PATH %s $PATH' "$PRINTMD_PREFIX")
            targets=("$HOME/.config/fish/config.fish")
            ;;
        */zsh)
            line=$(printf 'export PATH="%s:$PATH"' "$PRINTMD_PREFIX")
            targets=("$HOME/.zshrc")
            ;;
        */bash)
            line=$(printf 'export PATH="%s:$PATH"' "$PRINTMD_PREFIX")
            targets=("$HOME/.bashrc")
            if [ "$os" = "Darwin" ]; then
                if [ -f "$HOME/.bash_profile" ]; then
                    targets+=("$HOME/.bash_profile")
                else
                    targets+=("$HOME/.profile")
                fi
            fi
            ;;
        *)
            print_info "$PRINTMD_PREFIX is not on PATH and your shell (${SHELL:-unknown}) isn't recognized."
            print_info "Add it manually: export PATH=\"$PRINTMD_PREFIX:\$PATH\""
            return 0
            ;;
    esac

    local rc
    for rc in "${targets[@]}"; do
        update_rc_path_block "$rc" "$line"
        print_success "Added $PRINTMD_PREFIX to PATH in $rc"
    done
    print_info "Restart your shell or run: source ${targets[0]}"
}

resolve_documents_dir() {
    if [ -n "${XDG_DOCUMENTS_DIR:-}" ] && [ -d "$XDG_DOCUMENTS_DIR" ]; then
        printf '%s' "$XDG_DOCUMENTS_DIR"
    else
        printf '%s' "$HOME/Documents"
    fi
}

# Create ~/Documents/print-md and seed it with the bundled examples so the
# viewer's "Open Project" picker has something to show out of the box.
setup_print_md_directory() {
    print_step "Setting up print-md directory..."

    local documents_dir
    documents_dir="$(resolve_documents_dir)"
    mkdir -p "$documents_dir"

    PRINTMD_DIR="$documents_dir/print-md"
    mkdir -p "$PRINTMD_DIR"
    print_info "print-md directory: $PRINTMD_DIR"

    local examples_dir="$PRINTMD_DIR/examples"
    if [ -d "$examples_dir" ] && [ -n "$(ls -A "$examples_dir" 2>/dev/null)" ]; then
        print_info "Examples already present at $examples_dir (skipping)"
        return 0
    fi

    # Pull the source archive for the same tag and extract just `examples/`.
    local archive_url="https://api.github.com/repos/${REPO}/tarball/${PRINTMD_TAG}"
    local tmp_dir
    tmp_dir="$(mktemp -d)"

    print_info "Downloading examples..."
    if gh_download application/octet-stream -o "$tmp_dir/source.tar.gz" "$archive_url"; then
        if tar -xzf "$tmp_dir/source.tar.gz" -C "$tmp_dir"; then
            local extracted
            extracted="$(find "$tmp_dir" -maxdepth 1 -type d \( -name '*-print-md-*' -o -name 'print-md-*' \) | head -1)"
            if [ -n "$extracted" ] && [ -d "$extracted/examples" ]; then
                mkdir -p "$examples_dir"
                cp -R "$extracted/examples/." "$examples_dir/"
                print_success "Examples installed to $examples_dir"
            else
                print_info "examples/ not found in source archive"
            fi
        else
            print_info "Could not extract source archive"
        fi
    else
        print_info "Could not download source archive (skipping examples)"
    fi
    rm -rf "$tmp_dir"
}

create_desktop_shortcut() {
    if [ "$PRINTMD_OS" != "linux" ]; then
        return 0
    fi

    print_step "Creating desktop shortcut..."

    local desktop_dir="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
    if [ ! -d "$desktop_dir" ]; then
        print_info "Desktop directory not found, skipping shortcut"
        return 0
    fi

    local desktop_file="$desktop_dir/print-md-preview.desktop"
    local working_dir="${PRINTMD_DIR:-$HOME/Documents}"

    cat > "$desktop_file" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Print-md Preview
Comment=Start Print-md Preview Server
Exec=$PRINTMD_BIN preview --open true
Path=$working_dir
Terminal=true
StartupNotify=true
EOF

    chmod +x "$desktop_file"
    if command -v gio >/dev/null 2>&1; then
        gio set "$desktop_file" metadata::trusted true 2>/dev/null || true
    fi
    print_success "Desktop shortcut created: $desktop_file"
}

# ---- main ------------------------------------------------------------------

main() {
    echo ""
    echo "========================================"
    echo "  print-md Installation"
    echo "========================================"
    echo ""

    if ! command -v curl >/dev/null 2>&1; then
        print_error "curl is required but not installed"
        exit 1
    fi

    detect_platform
    print_info "Detected platform: $PRINTMD_OS/$PRINTMD_ARCH"

    print_step "Resolving release..."
    fetch_release
    print_info "Release: $PRINTMD_TAG"
    resolve_asset_url

    install_binary
    verify_install
    ensure_path
    setup_print_md_directory || true
    create_desktop_shortcut || true

    echo ""
    echo "========================================"
    echo "  Installation Complete!"
    echo "========================================"
    echo ""
    print_success "print-md is ready to use!"
    if [ -n "${PRINTMD_DIR:-}" ]; then
        echo ""
        print_info "Examples are at: $PRINTMD_DIR/examples"
    fi
    echo ""
    if [ "$PRINTMD_OS" = "linux" ] && [ -d "${XDG_DESKTOP_DIR:-$HOME/Desktop}" ]; then
        print_info "Double-click 'Print-md Preview' on your desktop to start the viewer."
    else
        print_info "Get started: print-md --help"
    fi
    echo ""

    # Last thing on screen, so an unverified install cannot be missed.
    if [ -n "$PRINTMD_UNVERIFIED" ]; then
        print_error "WARNING: this download was NOT verified against a checksum."
        print_info "Reason: $PRINTMD_UNVERIFIED"
        print_info "print-md binaries are unsigned, so nothing has confirmed this file's"
        print_info "integrity. To check it by hand, compare the sha256 of"
        print_info "  $PRINTMD_BIN"
        print_info "against the release page:"
        print_info "  https://github.com/${REPO}/releases/tag/${PRINTMD_TAG}"
        echo ""
    fi
}

main "$@"
