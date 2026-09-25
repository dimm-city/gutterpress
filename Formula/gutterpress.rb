class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.0"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.0/gutterpress-cli-macos-arm64"
      sha256 "e8fcf82155b522f34d20d085a56c90bea69694cb8a74afa4d2d16192701d12e2"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.0/gutterpress-cli-macos-x64"
      sha256 "1b6e1a90048be55fa2cdf2f88e569ac765a0b5e8e0bc1666d67a400c34ed78ad"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.0/gutterpress-cli-linux-arm64"
      sha256 "4ccac37e846aef281060fd8dad6c3ae76c824b457d82f1927cd1b969910b093d"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.0/gutterpress-cli-linux-x64"
      sha256 "4d9d529f4e8751248aeef99ec5559b4db5ca0a621a8b9772d1c006e88e52364d"
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
