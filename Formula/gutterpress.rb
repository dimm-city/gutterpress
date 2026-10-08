class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.15"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.15/gutterpress-cli-macos-arm64"
      sha256 "50c330c5a3e4fa3403b7d4af695b2573c7bef8fc9d3d87d7a596568ab286de90"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.15/gutterpress-cli-macos-x64"
      sha256 "e0da6936de25cda5e9e73175d8c4b34a52208ea71d763636f4dd4808d12dea8c"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.15/gutterpress-cli-linux-arm64"
      sha256 "d83289347af6fbf0bd4e06b1f48233b6ac7c05a7cf2b33340778a43b4b8cffa8"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.15/gutterpress-cli-linux-x64"
      sha256 "d574a7750f075ae71c5efe6474a14270a08e9888f3295a4ff10121a3ed1ef06e"
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
