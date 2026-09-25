class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.1"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.1/gutterpress-cli-macos-arm64"
      sha256 "0bdd81600826b1ab9b3ec0097d439aad35bc1ac14d9c54702f357d6477951306"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.1/gutterpress-cli-macos-x64"
      sha256 "60283e834f1665a685052346eacdde6193112f13693e02361f74a9655527118e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.1/gutterpress-cli-linux-arm64"
      sha256 "0da4f34ad9009ac1da7aa3f21ed6d9bebc6c964272c1594b07998effaf2c57bc"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.1/gutterpress-cli-linux-x64"
      sha256 "a7e66bcf6c68736449621eb1553c76be9616124a286d1c747ea393b56ddfc3d3"
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
