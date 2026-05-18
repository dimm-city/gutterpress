#!/bin/bash
#
# Convert images in a directory to CMYK color profile
# Requires: ImageMagick
#
# Usage: ./convert-to-cmyk.sh <input_dir> [output_dir] [options]
#

set -euo pipefail

# Defaults
INPUT_DIR=""
OUTPUT_DIR=""
PROFILE=""
SRGB_PROFILE=""
QUALITY=95
FORMAT=""
RECURSIVE=false
DRY_RUN=false
VERBOSE=false

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
	cat <<EOF
Usage: $(basename "$0") <input_dir> [output_dir] [options]

Convert images to CMYK color profile using ImageMagick.

Arguments:
  input_dir     Directory containing images to convert
  output_dir    Output directory (default: <input_dir>/cmyk)

Options:
  -p, --profile PATH    ICC profile path (default: USWebCoatedSWOP)
  -q, --quality N       JPEG quality 1-100 (default: 95)
  -f, --format FMT      Output format: jpg, tif, png (default: preserve original)
  -r, --recursive       Process subdirectories
  -n, --dry-run         Show what would be done without converting
  -v, --verbose         Verbose output
  -h, --help            Show this help

Examples:
  $(basename "$0") ./images
  $(basename "$0") ./images ./output -p /path/to/profile.icc -q 90
  $(basename "$0") ./images -r -f tif --profile USWebCoatedSWOP

Supported formats: jpg, jpeg, png, tif, tiff, psd, bmp
EOF
	exit 0
}

log() {
	if [[ "$VERBOSE" == true ]]; then
		echo -e "$1"
	fi
}

error() {
	echo -e "${RED}Error: $1${NC}" >&2
	exit 1
}

warn() {
	echo -e "${YELLOW}Warning: $1${NC}" >&2
}

success() {
	echo -e "${GREEN}$1${NC}"
}

# Check ImageMagick is installed
check_dependencies() {
	if ! command -v convert &>/dev/null; then
		if command -v magick &>/dev/null; then
			CONVERT_CMD="magick"
		else
			error "ImageMagick is required. Install with: apt-get install imagemagick"
		fi
	else
		CONVERT_CMD="convert"
	fi
	log "Using: $CONVERT_CMD"
}

# Get built-in ICC profile path
get_profile_path() {
	local profile_name="$1"

	# Common ICC profile locations
	local profile_dirs=(
		"/usr/share/color/icc"
		"/usr/share/ghostscript/*/iccprofiles"
		"/usr/local/share/color/icc"
		"$HOME/.local/share/color/icc"
	)

	# Check if it's already a full path
	if [[ -f "$profile_name" ]]; then
		echo "$profile_name"
		return 0
	fi

	# Search for profile
	for dir_pattern in "${profile_dirs[@]}"; do
		for dir in $dir_pattern; do
			if [[ -d "$dir" ]]; then
				local found=$(find "$dir" -iname "*${profile_name}*.icc" -o -iname "*${profile_name}*.icm" 2>/dev/null | head -1)
				if [[ -n "$found" ]]; then
					echo "$found"
					return 0
				fi
			fi
		done
	done

	# Return empty if not found (will use built-in CMYK)
	echo ""
}

get_srgb_profile_path() {
	# Best-effort: use Ghostscript's bundled sRGB profile when available.
	# If not found, return empty and rely on ImageMagick's default assumptions.
	local candidates=(
		"/usr/share/ghostscript/*/iccprofiles/srgb.icc"
		"/usr/share/ghostscript/*/iccprofiles/sRGB.icc"
		"/usr/share/color/icc/sRGB.icc"
	)
	for pat in "${candidates[@]}"; do
		for f in $pat; do
			if [[ -f "$f" ]]; then
				echo "$f"
				return 0
			fi
		done
	done
	echo ""
}

# Convert single image
convert_image() {
	local input_file="$1"
	local output_file="$2"

	local ext="${output_file##*.}"
	local format_opts=""

	# Format-specific options
	case "${ext,,}" in
	jpg | jpeg)
		format_opts="-quality $QUALITY"
		;;
	tif | tiff)
		format_opts="-compress lzw"
		;;
	png)
		format_opts="-quality 95"
		;;
	esac

	# Build conversion command
	local cmd=("$CONVERT_CMD" "$input_file")

	# Add profile conversion
	if [[ -n "$PROFILE" && -f "$PROFILE" ]]; then
		# IMPORTANT (IM6): -profile alone may embed a profile without actually converting
		# pixel data to CMYK colorspace. Force a real conversion.
		if [[ -n "$SRGB_PROFILE" && -f "$SRGB_PROFILE" ]]; then
			cmd+=("-profile" "$SRGB_PROFILE" "-profile" "$PROFILE")
		else
			cmd+=("-profile" "$PROFILE")
		fi
		cmd+=("-colorspace" "CMYK")
	else
		# Use built-in CMYK conversion
		cmd+=("-colorspace" "CMYK")
	fi

	# Add format options and output
	cmd+=($format_opts "$output_file")

	if [[ "$DRY_RUN" == true ]]; then
		echo "[DRY RUN] ${cmd[*]}"
		return 0
	fi

	# Execute conversion
	if "${cmd[@]}" 2>/dev/null; then
		log "  ${GREEN}✓${NC} $(basename "$input_file")"
		return 0
	else
		warn "Failed to convert: $input_file"
		return 1
	fi
}

# Process directory
process_directory() {
	local input_dir="$1"
	local output_dir="$2"
	local count=0
	local failed=0
	local skipped=0

	# Find pattern
	local find_opts=(-maxdepth 1)
	if [[ "$RECURSIVE" == true ]]; then
		find_opts=()
	fi

	# Supported extensions
	local extensions="jpg jpeg png tif tiff psd bmp"

	# Build find command
	local find_pattern=""
	for ext in $extensions; do
		if [[ -n "$find_pattern" ]]; then
			find_pattern="$find_pattern -o"
		fi
		find_pattern="$find_pattern -iname *.$ext"
	done

	# Create output directory
	mkdir -p "$output_dir"

	# Process files (deterministic order)
	local files=()
	mapfile -d '' -t files < <(find "$input_dir" "${find_opts[@]}" \( $find_pattern \) -type f -print0 2>/dev/null | LC_ALL=C sort -z)
	for file in "${files[@]}"; do
		local rel_path="${file#$input_dir/}"
		local out_file="$output_dir/$rel_path"

		# Change extension if format specified
		if [[ -n "$FORMAT" ]]; then
			out_file="${out_file%.*}.$FORMAT"
		fi

		# Create output subdirectory if needed
		mkdir -p "$(dirname "$out_file")"

		if [[ -f "$out_file" && ! "$file" -nt "$out_file" ]]; then
			log "Skipping (up-to-date): $rel_path"
			skipped=$((skipped + 1))
			continue
		fi

		log "Converting: $rel_path"
		if convert_image "$file" "$out_file"; then
			count=$((count + 1))
		else
			failed=$((failed + 1))
		fi
	done

	echo ""
	success "Converted: $count images"
	if [[ $skipped -gt 0 ]]; then
		log "Skipped: $skipped images (up-to-date)"
	fi
	if [[ $failed -gt 0 ]]; then
		warn "Failed: $failed images"
	fi
	echo "Output: $output_dir"
}

# Parse arguments
parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
		-p | --profile)
			PROFILE="$2"
			shift 2
			;;
		-q | --quality)
			QUALITY="$2"
			shift 2
			;;
		-f | --format)
			FORMAT="$2"
			shift 2
			;;
		-r | --recursive)
			RECURSIVE=true
			shift
			;;
		-n | --dry-run)
			DRY_RUN=true
			VERBOSE=true
			shift
			;;
		-v | --verbose)
			VERBOSE=true
			shift
			;;
		-h | --help)
			usage
			;;
		-*)
			error "Unknown option: $1"
			;;
		*)
			if [[ -z "$INPUT_DIR" ]]; then
				INPUT_DIR="$1"
			elif [[ -z "$OUTPUT_DIR" ]]; then
				OUTPUT_DIR="$1"
			else
				error "Unexpected argument: $1"
			fi
			shift
			;;
		esac
	done
}

main() {
	parse_args "$@"

	# Validate input
	if [[ -z "$INPUT_DIR" ]]; then
		usage
	fi

	if [[ ! -d "$INPUT_DIR" ]]; then
		error "Input directory not found: $INPUT_DIR"
	fi

	# Set default output directory
	if [[ -z "$OUTPUT_DIR" ]]; then
		OUTPUT_DIR="${INPUT_DIR%/}/cmyk"
	fi

	# Check dependencies
	check_dependencies

	# Resolve ICC profile
	if [[ -n "$PROFILE" ]]; then
		local resolved_profile
		resolved_profile=$(get_profile_path "$PROFILE")
		if [[ -n "$resolved_profile" ]]; then
			PROFILE="$resolved_profile"
			log "Using ICC profile: $PROFILE"
		else
			warn "ICC profile not found: $PROFILE (using built-in CMYK colorspace)"
			PROFILE=""
		fi
	fi

	# Resolve sRGB profile for proper RGB->CMYK conversion when using ICC
	SRGB_PROFILE=$(get_srgb_profile_path)
	if [[ -n "$PROFILE" && -n "$SRGB_PROFILE" ]]; then
		log "Using sRGB profile: $SRGB_PROFILE"
	fi

	echo "Converting images to CMYK..."
	echo "Input:  $INPUT_DIR"
	echo "Output: $OUTPUT_DIR"
	echo ""

	process_directory "$INPUT_DIR" "$OUTPUT_DIR"
}

main "$@"
