class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.13"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.13/gutterpress-cli-macos-arm64"
      sha256 "fe6273509d798d6066638a0dee42b7ccd8c61369147126b3525496839ae8f5d6"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.13/gutterpress-cli-macos-x64"
      sha256 "ae215581827588ed5c2b522d0f891ebd283fc4e43f0c6d939dae66bb904fc0bf"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.13/gutterpress-cli-linux-arm64"
      sha256 "f11452ef01ab386121493ed18e3b401a4b7a4a0d0c86a9e61c77fe05f86959ef"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.13/gutterpress-cli-linux-x64"
      sha256 "7b44624c0a0791942ce2c6d7b001221b7a5653456d4797928a025a69be81e31c"
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
