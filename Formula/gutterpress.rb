class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.19"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.19/gutterpress-cli-macos-arm64"
      sha256 "607c40da338a8a9693dd44324eef45ce797a841eec2e48218b547b5684f1ec4c"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.19/gutterpress-cli-macos-x64"
      sha256 "f3e72287e1c17b17bb3ef979c7d984adf5937692a3ad25cd50a852b2b69315ad"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.19/gutterpress-cli-linux-arm64"
      sha256 "3072cd77068e5de5aff8098640f43f319e4bf94169417327d0ef8f0d0fd05d86"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.19/gutterpress-cli-linux-x64"
      sha256 "6d2390beaf8e5649d63451c5813c4e195f3539bf33f49f6136a4ed10369ccaa3"
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
