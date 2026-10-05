class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.10"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.10/gutterpress-cli-macos-arm64"
      sha256 "a856bc5102f7dc5830d202fa6e593ae2eac5518ab4dc2b34289d618337abfcb5"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.10/gutterpress-cli-macos-x64"
      sha256 "9ed861158e63fc61f932f571d0db3446e74a752479e35a32e6e6d4922828e9a8"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.10/gutterpress-cli-linux-arm64"
      sha256 "36e2bf72db82700ab3cd5af0fff05f3a308200d791e2555f0512786a024e4fda"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.10/gutterpress-cli-linux-x64"
      sha256 "0e93d845633603623b72349f11dd5c2064f51c33bf73f2c08cba4b819d4ad8a3"
    end
  end

  def install
    artifact = Dir["gutterpress-cli-*"].first
    odie "gutterpress release artifact is missing" unless artifact
    chmod 0755, artifact
    bin.install artifact => "gutterpress"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gutterpress --version")
  end
end
