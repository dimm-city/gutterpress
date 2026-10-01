class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.9"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.9/gutterpress-cli-macos-arm64"
      sha256 "47a757683a98b6dd43454e1552e69d7e964bc672c4a585c6b688bb4276036526"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.9/gutterpress-cli-macos-x64"
      sha256 "968db1dfa31e7d7e12c38d5279b1873fa2a0bc7742a5b8e5a8c9d14c198b7e6d"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.9/gutterpress-cli-linux-arm64"
      sha256 "68ff9937c0bd660cdb3c1f0bfe3be94a725fe6e824fe81be0cc8302230921847"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.9/gutterpress-cli-linux-x64"
      sha256 "0b4cc536991f30875e4833088d68b9b77c55c5d14705b8061a56083024b2bc55"
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
