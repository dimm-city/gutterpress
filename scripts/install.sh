#!/usr/bin/env bash
# print-md installer for Linux and macOS
#
# Downloads the standalone binary for the current platform from GitHub
# Releases and drops it in ~/.local/bin. No bun, node, or git required.
#
#   curl -fsSL https://raw.githubusercontent.com/dimm-city/print-md/main/scripts/install.sh | bash
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
    PRINTMD_ASSET="print-md-${os}-${arch}"
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

# Find the download URL for our platform's asset by parsing the release JSON.
# Uses python3 if available (cleaner) or grep otherwise.
resolve_asset_url() {
    if command -v python3 >/dev/null 2>&1; then
        PRINTMD_ASSET_URL="$(printf '%s' "$PRINTMD_RELEASE_JSON" \
            | python3 -c "
import json, sys
data = json.load(sys.stdin)
asset_name = '$PRINTMD_ASSET'
for a in data.get('assets', []):
    if a.get('name') == asset_name:
        print(a.get('url', ''))
        break
")"
    else
        # Locate the asset block whose "name" matches and pull its API "url".
        PRINTMD_ASSET_URL="$(printf '%s' "$PRINTMD_RELEASE_JSON" \
            | tr '\n' ' ' \
            | grep -oE '\{[^{}]*"name"[^{}]*"'"$PRINTMD_ASSET"'"[^{}]*\}' \
            | head -1 \
            | grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' \
            | head -1 \
            | sed -E 's/.*"url"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
    fi

    if [ -z "$PRINTMD_ASSET_URL" ]; then
        print_error "Release $PRINTMD_TAG has no asset named $PRINTMD_ASSET"
        return 1
    fi
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

# Append the install dir to the user's shell rc if it isn't already on PATH.
ensure_path() {
    case ":$PATH:" in
        *":$PRINTMD_PREFIX:"*) return 0 ;;
    esac

    local rc=""
    case "${SHELL:-}" in
        */bash) rc="$HOME/.bashrc" ;;
        */zsh)  rc="$HOME/.zshrc" ;;
        */fish) rc="$HOME/.config/fish/config.fish" ;;
    esac

    if [ -z "$rc" ]; then
        print_info "$PRINTMD_PREFIX is not on PATH. Add it manually."
        return 0
    fi

    local line
    if [[ "${SHELL:-}" == */fish ]]; then
        line="set -gx PATH $PRINTMD_PREFIX \$PATH"
    else
        line="export PATH=\"$PRINTMD_PREFIX:\$PATH\""
    fi

    if [ -f "$rc" ] && grep -qF "$line" "$rc"; then
        return 0
    fi

    mkdir -p "$(dirname "$rc")"
    {
        printf '\n# Added by print-md installer\n'
        printf '%s\n' "$line"
    } >> "$rc"
    print_success "Added $PRINTMD_PREFIX to PATH in $rc"
    print_info "Restart your shell or run: source $rc"
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
            extracted="$(find "$tmp_dir" -maxdepth 1 -type d -name '*-print-md-*' -o -maxdepth 1 -type d -name 'print-md-*' | head -1)"
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
}

main "$@"
