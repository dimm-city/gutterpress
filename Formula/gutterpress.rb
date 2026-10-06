class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.11"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.11/gutterpress-cli-macos-arm64"
      sha256 "bc03efbafa6e5e527ac5b90c87556daf838aad361ace2523cbaafc142e265349"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.11/gutterpress-cli-macos-x64"
      sha256 "a34292760305378d955af1f1f25eb6fb01167f026d6ad03f8d2b5456687dbad8"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.11/gutterpress-cli-linux-arm64"
      sha256 "f76fc2e4f2e400c11492590decfa74563e400d73574f9458bdb3f12ac4bad22f"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.11/gutterpress-cli-linux-x64"
      sha256 "7e0c60c1ee82883da790f980f7de0b7d12bd35673dcb83d6bf6f3f51eccf94bc"
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
