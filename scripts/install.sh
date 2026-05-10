#!/usr/bin/env bash
# print-md Installation Script for Linux
# This script installs Bun and print-md globally for end users

set -e

# Configuration
PRINTMD_REPO="https://github.com/dimm-city/print-md.git"
PRINTMD_PACKAGE="@dimm-city/print-md"

# Color output functions
print_success() {
    echo -e "\033[0;32m[OK]\033[0m $1"
}

print_info() {
    echo -e "\033[0;36m[INFO]\033[0m $1"
}

print_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

print_step() {
    echo ""
    echo -e "\033[0;33m>>> $1\033[0m"
}

# Check and install Bun
install_bun() {
    print_step "Checking for Bun..."

    if command -v bun &> /dev/null; then
        local bun_version=$(bun --version)
        print_success "Bun is already installed (version $bun_version)"
        return 0
    fi

    print_info "Bun not found. Installing now..."
    print_info "This will download and install Bun from bun.sh"

    if curl -fsSL https://bun.sh/install | bash; then
        # Source bun environment
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"

        # Verify installation
        if command -v bun &> /dev/null; then
            print_success "Bun installed successfully!"
            return 0
        else
            print_error "Installation completed but Bun is not available yet"
            print_info "Please restart your terminal and run this script again"
            return 1
        fi
    else
        print_error "Failed to install Bun"
        print_info "Visit https://bun.sh for manual installation instructions"
        return 1
    fi
}

# Install print-md globally
install_printmd() {
    print_step "Installing print-md..."
    print_info "This may take a minute..."

    # Make sure Bun is in PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if bun add -g "$PRINTMD_REPO"; then
        print_success "print-md installed successfully!"
        return 0
    else
        print_error "Failed to install print-md"
        return 1
    fi
}

# Verify installation
test_installation() {
    print_step "Verifying installation..."

    # Make sure Bun is in PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if command -v print-md &> /dev/null; then
        local version=$(print-md --version 2>/dev/null || echo "unknown")
        print_success "print-md is working! (version $version)"
        return 0
    else
        print_error "print-md command not found"
        print_info "You may need to restart your terminal"
        return 1
    fi
}

# Determine the user's Documents directory (XDG-aware on Linux)
resolve_documents_dir() {
    if [ -n "$XDG_DOCUMENTS_DIR" ] && [ -d "$XDG_DOCUMENTS_DIR" ]; then
        echo "$XDG_DOCUMENTS_DIR"
    else
        echo "$HOME/Documents"
    fi
}

# Create ~/Documents/print-md and seed it with the bundled examples so that
# the viewer's "Open Project" picker has something to show out of the box.
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

    if ! command -v git &> /dev/null; then
        print_info "git not found — skipping examples download"
        print_info "You can clone examples manually from $PRINTMD_REPO"
        return 0
    fi

    print_info "Cloning examples from $PRINTMD_REPO..."
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    if git clone --depth 1 --quiet "$PRINTMD_REPO" "$tmp_dir/repo"; then
        if [ -d "$tmp_dir/repo/examples" ]; then
            mkdir -p "$examples_dir"
            cp -R "$tmp_dir/repo/examples/." "$examples_dir/"
            print_success "Examples installed to $examples_dir"
        else
            print_info "No examples directory found in repository"
        fi
    else
        print_info "Could not clone repository for examples"
    fi
    rm -rf "$tmp_dir"
    return 0
}

# Create desktop shortcut (Linux .desktop file)
create_desktop_shortcut() {
    print_step "Creating desktop shortcut..."

    # Determine desktop directory
    if [ -n "$XDG_DESKTOP_DIR" ]; then
        DESKTOP_DIR="$XDG_DESKTOP_DIR"
    elif [ -d "$HOME/Desktop" ]; then
        DESKTOP_DIR="$HOME/Desktop"
    else
        print_info "Desktop directory not found, skipping shortcut creation"
        return 0
    fi

    # Find print-md installation path
    local printmd_path=$(command -v print-md)
    local bun_path=$(command -v bun)

    if [ -z "$printmd_path" ] || [ -z "$bun_path" ]; then
        print_error "Could not locate print-md or bun binary"
        return 1
    fi

    # Find icon file
    local icon_path=""
    local global_modules_path="$HOME/.bun/install/global/node_modules/@dimm-city/print-md/dist/assets/favicon.ico"
    local package_icon_path="$(dirname "$printmd_path")/assets/favicon.ico"

    if [ -f "$global_modules_path" ]; then
        icon_path="$global_modules_path"
    elif [ -f "$package_icon_path" ]; then
        icon_path="$package_icon_path"
    else
        print_info "Icon not found, using default"
    fi

    # Create .desktop file
    local desktop_file="$DESKTOP_DIR/print-md-preview.desktop"
    local working_dir="${PRINTMD_DIR:-$HOME/Documents}"

    cat > "$desktop_file" << DESKTOPEOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Print-md Preview
Comment=Start Print-md Preview Server
Exec=$bun_path run print-md preview --open true
Path=$working_dir
Terminal=true
StartupNotify=true
DESKTOPEOF

    # Add icon if found
    if [ -n "$icon_path" ]; then
        echo "Icon=$icon_path" >> "$desktop_file"
        print_info "Using icon: $icon_path"
    fi

    # Make executable
    chmod +x "$desktop_file"

    # Try to mark as trusted (GNOME)
    if command -v gio &> /dev/null; then
        gio set "$desktop_file" metadata::trusted true 2>/dev/null || true
    fi

    print_success "Desktop shortcut created: $desktop_file"
    print_info "Double-click 'Print-md Preview' on your desktop to start the preview server"
    return 0
}

# Main installation flow
main() {
    echo ""
    echo "========================================"
    echo "  print-md Installation"
    echo "========================================"
    echo ""
    print_info "This will install print-md globally on your system"
    echo ""

    # Step 1: Install Bun
    if ! install_bun; then
        print_error "Installation failed. Please try again."
        exit 1
    fi

    # Step 2: Install print-md globally
    if ! install_printmd; then
        print_error "Installation failed. Please try again."
        exit 1
    fi

    # Step 3: Verify
    if ! test_installation; then
        print_info "Installation completed but verification failed"
        print_info "Try closing this terminal and running 'print-md --version' in a new terminal"
        exit 0
    fi

    # Step 4: Set up ~/Documents/print-md and seed examples
    setup_print_md_directory || true

    # Step 5: Create desktop shortcut
    create_desktop_shortcut || true

    # Success!
    echo ""
    echo "========================================"
    echo "  Installation Complete!"
    echo "========================================"
    echo ""
    print_success "print-md is ready to use!"
    echo ""
    if [ -n "$PRINTMD_DIR" ]; then
        print_info "Examples are available at: $PRINTMD_DIR/examples"
        echo ""
    fi
    print_info "Quick Start Options:"
    echo ""
    echo "  Option 1: Use Desktop Shortcut"
    echo "    - Double-click 'Print-md Preview' on your desktop"
    echo "    - The viewer's 'Open Project' picker starts in $PRINTMD_DIR"
    echo "      so you can browse the bundled examples right away"
    echo ""
    echo "  Option 2: Use Command Line"
    echo "    1. Create a folder with your markdown files"
    echo "    2. Open a terminal in that folder"
    echo "    3. Run:"
    echo ""
    echo "       print-md build"
    echo ""
    print_info "This will create a PDF from your markdown files."
    echo ""
    print_info "For more options: print-md --help"
    echo ""
}

# Run main installation
main
