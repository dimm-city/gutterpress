class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.18"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.18/gutterpress-cli-macos-arm64"
      sha256 "2cd6c34c4167822f70cc07568c50e3679aeba95aff4ea8b9ac1a73e533b128fb"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.18/gutterpress-cli-macos-x64"
      sha256 "93a11481856c423b824f627f92f6996ad81cd6a9a0b05dd26dc8b0c4b52ddc8e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.18/gutterpress-cli-linux-arm64"
      sha256 "1d6dfb532719b7b3772544d6d1b9345995d0b11a4c0a6782aaf7f59e58b3bec1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.18/gutterpress-cli-linux-x64"
      sha256 "0885f4279f4b3116ef34702049c6357ce05b202223203778df75cb9c8f5dbf5e"
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
