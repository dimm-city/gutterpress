class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.17"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.17/gutterpress-cli-macos-arm64"
      sha256 "34543d95c0564265f0ebc803c22e85ab4a64dd69cdac7de2a88aa2766bb0afff"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.17/gutterpress-cli-macos-x64"
      sha256 "ae4ff1510490fe864c280488b930807cebf5a73fb4424f9679617f9581652284"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.17/gutterpress-cli-linux-arm64"
      sha256 "033061c1df3566c76e730f40f2c2f1ec955066991a7487ed62b9af3906889fe1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.17/gutterpress-cli-linux-x64"
      sha256 "6e7d54803d54667c497b3a0a0353c709021c5375a8ae1d0c5efc6cff288fa41b"
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
