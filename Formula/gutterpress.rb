class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.3"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.3/gutterpress-cli-macos-arm64"
      sha256 "7a3dff7a6ae9e379243dad9b177599e3b62da9f55d94ddb2f346b15cb9bf3677"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.3/gutterpress-cli-macos-x64"
      sha256 "d6b1199d339c3f6ab4c697af15f06d518b0441dc9d3b38b7f46f9ef979278bdd"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.3/gutterpress-cli-linux-arm64"
      sha256 "d12064800a961490e241d2adab26b9680aa57b9ab1455cc73e53df77e1544d18"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.3/gutterpress-cli-linux-x64"
      sha256 "eb978e5b5e898eb2c9ac50337d1809fa46917762b20ceb401d6bd7bdea0fdecc"
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
