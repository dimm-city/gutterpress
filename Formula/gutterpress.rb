class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.10.11"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.11/gutterpress-cli-macos-arm64"
      sha256 "e5e7e6d57e15f8706a68b8384961f394953833482eafc68e48dc57fc7c73019a"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.11/gutterpress-cli-macos-x64"
      sha256 "19c3b2c469489b2fa53c9006bbdc5e6eeb940a31d9ba2d97cfdcdebd7f1ab668"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.11/gutterpress-cli-linux-arm64"
      sha256 "a228e8adeeb592d0808d486a560a4d8de5da7ee8b47dc7fba3ba3f58480bf0a1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.10.11/gutterpress-cli-linux-x64"
      sha256 "845d44e30684bff0c3c2d09fa5bb72a5ebce5ef2c8a692ec72db2fe2af9843a1"
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
