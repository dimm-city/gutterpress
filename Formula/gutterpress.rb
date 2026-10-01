class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.7"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.7/gutterpress-cli-macos-arm64"
      sha256 "7c5594e5474c073b582df6c237cd3bb25a9f40c4f63acbdd12545e91458ae5f3"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.7/gutterpress-cli-macos-x64"
      sha256 "b533e94b6b413f2ed44fc3d0fb898fc6f55eeed96b33ce882a5715ecb623eb99"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.7/gutterpress-cli-linux-arm64"
      sha256 "480f3de5b30db4a55137faad999e4ad5ea1c7fff1fab5da30caffcc8d08f9bc4"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.7/gutterpress-cli-linux-x64"
      sha256 "52e95ad8f853710fad40bd3c309114839cc05d53966723ec203fa41933daff77"
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
