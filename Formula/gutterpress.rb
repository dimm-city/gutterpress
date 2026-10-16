class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.21"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.21/gutterpress-cli-macos-arm64"
      sha256 "70042a53d08f89e42960dfe52ac6e279557040732b4391f7078f898831e5c6da"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.21/gutterpress-cli-macos-x64"
      sha256 "c0aa7da426406faa2c61417de11a0796620e9ad44a343344822b2ecda3472e62"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.21/gutterpress-cli-linux-arm64"
      sha256 "965423b2e7063052e5469cbc021b3c8b425b6c0dc949397d8738d1c6c7011a63"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.21/gutterpress-cli-linux-x64"
      sha256 "73522feee17e42acd8f2c99618d1a4d9a2d7b5b87e5b0b10056e65abe14a3b32"
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
