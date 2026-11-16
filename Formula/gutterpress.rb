class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.28"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.28/gutterpress-cli-macos-arm64"
      sha256 "a8b04b1deb8a5346b387ad8e40322950d22911e0092c3c2a65debf276f7a8b49"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.28/gutterpress-cli-macos-x64"
      sha256 "355024c157e44be2700aa2fe36dee0dec62ff71ebebbedceb42adfae898d60e7"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.28/gutterpress-cli-linux-arm64"
      sha256 "489107e25d6c13a5fa0b908219e5d1f738c4f57a2f9c93e80cb344f87c690709"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.28/gutterpress-cli-linux-x64"
      sha256 "656212973b6ceca0d54e7a6d8fc41a107f76705a96f0474208040ae2365979a5"
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
