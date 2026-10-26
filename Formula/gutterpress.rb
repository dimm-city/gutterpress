class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.22"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.22/gutterpress-cli-macos-arm64"
      sha256 "605e66174b76b3d7b403e82f16ace2f67cb59d21d8d434a79e48bc22deb748ab"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.22/gutterpress-cli-macos-x64"
      sha256 "5a2b97a505e2af1327b376bcff1ca7d029debb35434bf255cc1f39d8ef6570e6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.22/gutterpress-cli-linux-arm64"
      sha256 "1aa44bd6e2b27a0d357607b7a48b198a41ca957319ad1243c08d6d1a710482c0"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.22/gutterpress-cli-linux-x64"
      sha256 "8eaca31e48d33d4ab704b4b3808c53358a23f406df467a0012ab4900fffbc07e"
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
