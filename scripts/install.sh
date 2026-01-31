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

    cat > "$desktop_file" << DESKTOPEOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Print-md Preview
Comment=Start Print-md Preview Server
Exec=$bun_path run print-md preview --open true
Path=$HOME/Documents
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

    # Step 4: Create desktop shortcut
    create_desktop_shortcut || true

    # Success!
    echo ""
    echo "========================================"
    echo "  Installation Complete!"
    echo "========================================"
    echo ""
    print_success "print-md is ready to use!"
    echo ""
    print_info "Quick Start Options:"
    echo ""
    echo "  Option 1: Use Desktop Shortcut"
    echo "    - Double-click 'Print-md Preview' on your desktop"
    echo "    - This will open the preview server in your browser"
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
