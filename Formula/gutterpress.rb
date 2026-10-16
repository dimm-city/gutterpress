class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.20"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.20/gutterpress-cli-macos-arm64"
      sha256 "2f2ab780bec35834ed378484de60e119fc938a71522a4423f3730546ad373bbd"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.20/gutterpress-cli-macos-x64"
      sha256 "bbee77e49b8ce54837e7a44b3b25e6b02d40642b02ab6c18257e5ecb15e19c82"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.20/gutterpress-cli-linux-arm64"
      sha256 "bdc1711c69125418f07f01f9e2ddc27286ce8e2cb0f3c31bbfd7a508a6d389dd"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.20/gutterpress-cli-linux-x64"
      sha256 "3e0c0692194d7e033ddaaa0d5c5991f63057605e2b57737a97f81bb7e2576b91"
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
