class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.10.10"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.10/gutterpress-cli-macos-arm64"
      sha256 "44251645ced688905ef4334748ba9c064c66fe93567f02cca3167949279f771d"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.10/gutterpress-cli-macos-x64"
      sha256 "a3579524ba5b3906a37b852010576bf43eb4eec2a5bd98d08841822db7b045a0"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.10/gutterpress-cli-linux-arm64"
      sha256 "c269168a564dca5694c7813a1a6dc552e8b5d9a841611d8adcdb14b21f53fe7f"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.10/gutterpress-cli-linux-x64"
      sha256 "7434299e07017039fc3fc027bd8a5ab40fd1f1b59b462264856028aa97b6293a"
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
