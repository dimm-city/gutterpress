class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.6"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.6/gutterpress-cli-macos-arm64"
      sha256 "b442aaa2d70c31361962a8e75664843c9dad0ca5d1af71aa49419d2c0257c0cf"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.6/gutterpress-cli-macos-x64"
      sha256 "bafd91760b3d10ec36ce4653a36cc53ebb9143ce66a40cea4216ae5a5e8b8861"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.6/gutterpress-cli-linux-arm64"
      sha256 "6a90aac3d3d0d4c667772d2ab0681b0670a6e1fc05e548fe672fd6409bdd9c60"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.6/gutterpress-cli-linux-x64"
      sha256 "789b615d9c92557d8d8af40184d5399ed9f20d85c43963471056756687db766e"
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
