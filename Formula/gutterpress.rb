class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.23"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.23/gutterpress-cli-macos-arm64"
      sha256 "1152ca09b739b673e03f54cc92b615b76f9f3e0aedc70d96badf2260845c4ba5"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.23/gutterpress-cli-macos-x64"
      sha256 "450c3736ae92b9b3d4bb475a2d2e3e02d3f4cfceb062ed9e999365ba325aa596"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.23/gutterpress-cli-linux-arm64"
      sha256 "a37456953b55af4e77f3d7354c757649942a2cfc7f6918d016ecae3b5e7e4baa"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.23/gutterpress-cli-linux-x64"
      sha256 "77576b3754d9968b0e74e2bc755246f59810117a23fc4ed968f0872bd866115f"
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
