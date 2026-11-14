class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.26"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.26/gutterpress-cli-macos-arm64"
      sha256 "9d6cfb97c20e89893abda47d2db722be1536ef724e486c062593af0f2269ba96"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.26/gutterpress-cli-macos-x64"
      sha256 "d3143e6f4c9a29cc0e2300abd7ac774edcc9c6a46cdbdb63d7be21174bcf89bf"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.26/gutterpress-cli-linux-arm64"
      sha256 "53904c32ea3c5b2b7ed559da78f5c4ccac78c9abb0e650e6ed55b8d9990780ca"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.26/gutterpress-cli-linux-x64"
      sha256 "2811d64cb653a6e2f99df8c7a1125be8f9d52408fa664fefe08592bfde647040"
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
