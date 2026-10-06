class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/dimm-city/gutterpress"
  version "0.11.14"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.14/gutterpress-cli-macos-arm64"
      sha256 "d86df39f42b45928ee7c26d6123cb87316e9b896fa5d28e30673d2395e63826b"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.14/gutterpress-cli-macos-x64"
      sha256 "2788b926cffbfe195879091f454367aa533c011d09f4fd0df098af1549f3c388"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.14/gutterpress-cli-linux-arm64"
      sha256 "e3eaaf77f128cfb7bde8339e117d713d9ffa41fd93768d9bcd0fdfbf126520e7"
    else
      url "https://github.com/dimm-city/gutterpress/releases/download/v0.11.14/gutterpress-cli-linux-x64"
      sha256 "342adef1198660f5322b9b90a3eec58627c64e9bee1f97e520bbab01ab276db2"
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
