# typed: false
# frozen_string_literal: true

class Hive < Formula
  desc "Coding agent tools: worktrees, workflows, workers and a local work board"
  homepage "https://github.com/codethread/hive"
  url "https://github.com/codethread/hive/archive/refs/tags/v0.6.3.tar.gz"
  sha256 "6c6a04c53a270ead308423208a59927594934d30aed276e2b7df7f110386cd2b"

  depends_on "oven-sh/bun/bun" => :build
  depends_on "dicklesworthstone/tap/br"
  depends_on "dicklesworthstone/tap/bv"
  depends_on "git"

  def fetch
    ENV["BUN_INSTALL_CACHE_DIR"] = buildpath/".bun-cache"
    system "bun", "install", "--frozen-lockfile", "--ignore-scripts"
  end

  def install
    {
      "beeswax"   => %w[beeswax],
      "honeycomb" => %w[honeycomb],
      "colony"    => %w[bee colony colony-runtime colony-worker colony-watchdog],
      "busybee"   => %w[busybee],
      "qlock"     => %w[qlock],
      "hive-ui"   => %w[hive-ui],
    }.each do |package, commands|
      cd "lib/#{package}" do
        system "bun", "run", "build"
        bin.install commands.map { |command| "dist/#{command}" }
      end
    end
  end

  test do
    %w[beeswax honeycomb bee colony colony-runtime colony-worker colony-watchdog busybee qlock
       hive-ui].each do |command|
      assert_equal version.to_s, shell_output("#{bin}/#{command} --version").strip
    end
    system bin/"honeycomb", "--help"
    system bin/"busybee", "--help"
    system bin/"qlock", "status", "--lock", testpath/"queue.lock", "--json"
    refute_path_exists testpath/".beads"
  end
end
