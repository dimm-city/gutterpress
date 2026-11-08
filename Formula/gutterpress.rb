class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.24"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.24/gutterpress-cli-macos-arm64"
      sha256 "42754f4db0786e179bb738f167367ae4039aff178a3fb6519f9b74d9d611aca5"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.24/gutterpress-cli-macos-x64"
      sha256 "da4b744cb1d1ae664d9bec17718c481fbf07056e81fc594d94a5a98401a4026a"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.24/gutterpress-cli-linux-arm64"
      sha256 "5ec2b9ebbc5bb6e0feaa5bf0377fcbbb0b6134856cef8b5643c27b3b110b92de"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.24/gutterpress-cli-linux-x64"
      sha256 "98c84e18649071f7f67a8da5cfa89a554a1e476dc563f68ffde99c0111c24b35"
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
