class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.25"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.25/gutterpress-cli-macos-arm64"
      sha256 "ad6dfe3b1ba32d2b3b3fe4a06f5798e1ae6c97d894eb2d12fa7700ffd36622d1"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.25/gutterpress-cli-macos-x64"
      sha256 "307a9c473ede3a35c3598b30589c50ef3c3a6512db754022d632b34e2f630c14"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.25/gutterpress-cli-linux-arm64"
      sha256 "cc1c8e095301b4941f561166732083ada1efc7f7207d567023fbc00cce968940"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.25/gutterpress-cli-linux-x64"
      sha256 "7c7fc532d2346a48d6a200e6a9787e1ffeefe253433db244d7edea4f419ef4f2"
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
