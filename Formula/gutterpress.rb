class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.29"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.29/gutterpress-cli-macos-arm64"
      sha256 "1983d61fe29b54857aaab39bb0c0c2e46cf53c0e3a711d71b97e00a4d4e4e6ff"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.29/gutterpress-cli-macos-x64"
      sha256 "977fc6d4dbc3080e81003adcfe1077c03e5014dbdde586c1f7d853686ae517b9"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.29/gutterpress-cli-linux-arm64"
      sha256 "ec6fb33e89b4575a255008e08d4c827bbe2a4d6bfad27edf6e7198e096106624"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.29/gutterpress-cli-linux-x64"
      sha256 "24e6aeb393a00105219bf025ab1afabe0850f255eb3be34286cd75e699aef5c5"
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
