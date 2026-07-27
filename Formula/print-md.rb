class PrintMd < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/print-md"
  version "0.8.3"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/print-md/releases/download/v0.8.3/print-md-cli-macos-arm64"
      sha256 "1bb1b67b4c9d7212a676da26eb4ef3bebfe675022ad9bd60c4af9c73eef4ccca"
    else
      url "https://github.com/dimm-city/print-md/releases/download/v0.8.3/print-md-cli-macos-x64"
      sha256 "5a16e11eaa06e03cf54ce0af7d15a7245385d65f7de9560e0d01c1feabb68471"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/print-md/releases/download/v0.8.3/print-md-cli-linux-arm64"
      sha256 "eba400637839c49a2ad8f08f9497b5b5630bce449087dd0cdd2a6312c30ac9fa"
    else
      url "https://github.com/dimm-city/print-md/releases/download/v0.8.3/print-md-cli-linux-x64"
      sha256 "646fa3a58b447d832cad7df6e1975febc425d8af3eb3b1ae876e74ecbf7f94d4"
    end
  end

  def install
    artifact = Dir["print-md-cli-*"].first
    odie "print-md release artifact is missing" unless artifact
    chmod 0755, artifact
    bin.install artifact => "print-md"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/print-md --version")
  end
end
