class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.2"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.2/gutterpress-cli-macos-arm64"
      sha256 "7a2dfc5bd0029252440588c61e4f654960039ec86bf2ac99458f2ea484bde487"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.2/gutterpress-cli-macos-x64"
      sha256 "2c7eda3a021d99b4a118088120bae8424b366f856403c7743d0633fae94c56e6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.2/gutterpress-cli-linux-arm64"
      sha256 "f8692c26f34559ceb66e784b576f84ddce762e379990fdb2369314db871e270c"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.2/gutterpress-cli-linux-x64"
      sha256 "73e81c376cfbe988f0b7c1c00ae2ac9344bceb8caa38364d3be3e13354fc84cf"
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
