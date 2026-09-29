class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.5"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.5/gutterpress-cli-macos-arm64"
      sha256 "75c1c3c4ee88ea12369a90dfa8aac7a4828dc40ced75552109981b74f28a161a"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.5/gutterpress-cli-macos-x64"
      sha256 "c221cbfa888794c29bcc20d142ce3a27365a5ccdcfccb6974bd2a2c48a1b0819"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.5/gutterpress-cli-linux-arm64"
      sha256 "420f59affa6a7ae8c294df422bc79ed9248b8eec7ff7b13572d8500d5d4aa6c4"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.5/gutterpress-cli-linux-x64"
      sha256 "98de465063470774dad8b8fe8504f3902f9aebdecfc19e5fdf1a776b99915d82"
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
