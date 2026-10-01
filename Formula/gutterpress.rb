class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.8"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.8/gutterpress-cli-macos-arm64"
      sha256 "46b4874a94075ecf48ea4be5018d96f40373cd89bb37236b77e8cf12a6790fa7"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.8/gutterpress-cli-macos-x64"
      sha256 "5146d6ec6aa404bd739e7e53aad998313670f53710b4f5e3c8139c22a18e1e27"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.8/gutterpress-cli-linux-arm64"
      sha256 "575111fc6fb590c66b8e132baecd0cc60f697d46e48efb29e99b1ed7e8594ea6"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.8/gutterpress-cli-linux-x64"
      sha256 "d35053abd516094b82504307c0eeeb48bd3a67da37e68841c0197c7aeb834914"
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
