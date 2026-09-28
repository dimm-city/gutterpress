class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.4"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.4/gutterpress-cli-macos-arm64"
      sha256 "0653605b277dd687ccb3e59fae4a8f8bcae0c0fc63713b1ecb977e24ad8a5cf4"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.4/gutterpress-cli-macos-x64"
      sha256 "024cf7e714734f594d30e11dfbb531de760007b07fce561d841cce200c40fab3"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.4/gutterpress-cli-linux-arm64"
      sha256 "fbb9198850d872653765baf735afd5e6d83f05a4fb3bc97075c180ad070407bc"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.4/gutterpress-cli-linux-x64"
      sha256 "b02dff081244c7f59b3903a8cb7310d19c68351d205cb4f1eaeb5db6bbcc3cfd"
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
