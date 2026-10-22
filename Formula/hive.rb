# typed: false
# frozen_string_literal: true

class Hive < Formula
  desc "Coding agent tools: worktrees, workflows, workers and a local work board"
  homepage "https://github.com/codethread/hive"
  url "https://github.com/codethread/hive/archive/53a3e07cff1336c5bb6a7625f3d2ad16b40ef416.tar.gz"
  version "0.9.0"
  sha256 "20a7661b2b8232e316f6ce36beaa4da705bba740e17138371d39efc65c9361f6"

  depends_on "oven-sh/bun/bun" => :build
  depends_on "rust" => :build
  depends_on "dicklesworthstone/tap/bv"
  depends_on "git"

  resource "beads_rust" do
    url "https://github.com/codethread/beads_rust.git",
        revision: "b77ae7094e9fde7cba304ba00d306ec483c6bdd2"
  end

  def fetch
    ENV["BUN_INSTALL_CACHE_DIR"] = buildpath/".bun-cache"
    system "bun", "install", "--frozen-lockfile", "--ignore-scripts"
    resource("beads_rust").stage buildpath/"beads_rust"
    cd "beads_rust" do
      system "cargo", "fetch", *std_cargo_fetch_args
    end
  end

  def install
    cd "beads_rust" do
      system "cargo", "install", *std_cargo_args, "--no-default-features", "--bin", "br"
    end
    {
      "beeswax"   => %w[beeswax],
      "honeycomb" => %w[honeycomb],
      "colony"    => %w[bee colony colony-runtime colony-worker colony-watchdog],
      "busybee"   => %w[busybee],
      "qlock"     => %w[qlock],
      "hive-ui"   => %w[hive-ui],
      "scent"     => %w[scent],
    }.each do |package, commands|
      cd "lib/#{package}" do
        system "bun", "run", "build"
        bin.install commands.map { |command| "dist/#{command}" }
      end
    end
  end

  def br_path_warning(paths)
    selected = which("br", paths)
    return if selected && File.identical?(selected, opt_bin/"br")

    "Warning: PATH selects #{selected || "no br executable"}; Hive requires #{opt_bin}/br. " \
      "Put #{opt_bin} before other br installations in PATH."
  end

  def caveats
    br_path_warning(ORIGINAL_PATHS)
  end

  test do
    native = JSON.parse(shell_output("#{bin}/br version --json"))
    assert_equal "b77ae7094e9fde7cba304ba00d306ec483c6bdd2", native.fetch("commit")
    refute_includes native.fetch("features", []), "self_update"
    assert_match "--from", shell_output("#{bin}/br sync --help")
    assert_match "--base", shell_output("#{bin}/br sync --help")

    assert_nil br_path_warning([bin])
    shadow = testpath/"shadow"
    shadow.mkpath
    (shadow/"br").write "#!/bin/sh\nexit 0\n"
    (shadow/"br").chmod 0755
    assert_match "PATH selects #{shadow}/br", br_path_warning([shadow, bin])
    assert_match "no br executable", br_path_warning([])
    warning = br_path_warning(ORIGINAL_PATHS)
    opoo warning if warning

    %w[beeswax honeycomb bee colony colony-runtime colony-worker colony-watchdog busybee qlock
       hive-ui scent].each do |command|
      assert_equal version.to_s, shell_output("#{bin}/#{command} --version").strip
    end
    system bin/"honeycomb", "--help"
    system bin/"busybee", "--help"
    system bin/"qlock", "status", "--lock", testpath/"queue.lock", "--json"
    refute_path_exists testpath/".beads"
  end
end
