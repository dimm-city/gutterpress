class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.27"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.27/gutterpress-cli-macos-arm64"
      sha256 "4bdd52679aea32efbd4dcce417db88daa8b4d147b4685a4637ba660e96e31bf1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.27/gutterpress-cli-macos-x64"
      sha256 "555dc4b5ba856a82d5cebaadbf4ef5af697b05da5eebd3ce572b2c3e9e25cbcd"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.27/gutterpress-cli-linux-arm64"
      sha256 "b803bee0d5e971ee6d714f272c943138f1681e54e16d14fbe3dd835bfe2c61c4"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.27/gutterpress-cli-linux-x64"
      sha256 "783a84e2eab408bcb249e86351f0c35727591e2575b479a918abdd00b495ea84"
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
