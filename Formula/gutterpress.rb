class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.12"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.12/gutterpress-cli-macos-arm64"
      sha256 "c44d2304d64b63dfaa05853b0ef23b6e69430c164677204250e835d96523d03e"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.12/gutterpress-cli-macos-x64"
      sha256 "935480d00a9188646e8e1fc2089b905f2444c6ec0b8a0202d8626f1aa65f449f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.12/gutterpress-cli-linux-arm64"
      sha256 "2159d33332c7e3df95b66cb6417afe2a7ef97681f63375778d81f3a6dfe62f38"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.12/gutterpress-cli-linux-x64"
      sha256 "4f2fac2a5698622dedaff260c33682305dff4487fc2e94b2b492536fa59bcfad"
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
