class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.16"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.16/gutterpress-cli-macos-arm64"
      sha256 "57bb58ecd6cd9d3a021069839c8c3c207f6cf63d193e140ec8c97d463a82337b"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.16/gutterpress-cli-macos-x64"
      sha256 "01503e909887bbd14159e3df73b816e78dc4cdb639a566bc22de323722042bd6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.16/gutterpress-cli-linux-arm64"
      sha256 "8577f516d74a263752757f06548a1c73cbf12258e0face4897b56f0f2ee74fc1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.16/gutterpress-cli-linux-x64"
      sha256 "a2a11714993b7e65a3611325757fd345a78612da7073a620c00ac855ebd94459"
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
