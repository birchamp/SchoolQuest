#!/usr/bin/env node
/**
 * Keeps the desktop app's version in one piece.
 *
 * Three files independently declare it, and each one is read by something different: the Cargo
 * manifest sets the version stamped into the Windows executable's resource table (tauri-build
 * reads `config.version` and calls `set_version_info`), `tauri.conf.json` sets the version in the
 * installer's filename and in Add or Remove Programs, and the package manifest is what a human
 * reads. Nothing checks that they agree.
 *
 * The failure that motivated this is quiet and confusing rather than loud: tagging `v0.2.0`
 * builds and publishes a release whose asset is still called `SchoolQuest_0.1.0_x64-setup.exe`,
 * and a student who already has 0.1.0 installed sees Windows offer to repair the same version
 * rather than upgrade. So the release workflow asserts the tag and the three files are the same
 * string, and `set` makes bumping them a single command rather than four hand edits.
 *
 *   node tools/version.mjs check [expected]
 *   node tools/version.mjs set <version>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Each entry finds the version with a regex rather than by parsing, so that `set` can rewrite it
 * without reformatting the file around it — a JSON round-trip through this script would reflow
 * `tauri.conf.json` and bury the real change in a diff nobody reads.
 */
const SITES = [
  {
    path: "apps/desktop/package.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    // Anchored to the [package] block: the manifest has other version keys under [dependencies],
    // and the first `version =` in the file is the one that belongs to this crate only because
    // [package] comes first. Matching from the section header says so.
    path: "apps/desktop/src-tauri/Cargo.toml",
    pattern: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  },
  {
    // The lockfile pins the crate's own version too. Left stale, the next `cargo build` rewrites
    // it and the release commit picks up an unrelated-looking diff.
    path: "apps/desktop/src-tauri/Cargo.lock",
    pattern: /(name = "schoolquest"\nversion = ")([^"]+)(")/,
  },
];

function read(site) {
  const text = readFileSync(join(root, site.path), "utf8");
  const match = text.match(site.pattern);
  if (!match) throw new Error(`No version found in ${site.path}`);
  return { text, match };
}

function check(expected) {
  const found = SITES.map((site) => ({ path: site.path, version: read(site).match[2] }));
  const target = expected ?? found[0].version;
  const wrong = found.filter((f) => f.version !== target);

  if (wrong.length === 0) {
    console.log(`Version ${target} agrees across ${found.length} files.`);
    return 0;
  }

  console.error(
    expected
      ? `Tag says ${expected}, but these files disagree:`
      : `The declared versions disagree (taking ${target} from ${found[0].path}):`,
  );
  for (const f of wrong) console.error(`  ${f.path}: ${f.version}`);
  console.error(`\nFix with: pnpm version:set ${target}`);
  return 1;
}

function set(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    // Tauri parses this with semver and Windows resource versions are four numeric fields, so a
    // prerelease suffix silently drops out of the executable's version info while staying in the
    // installer filename. Refusing is clearer than shipping two different answers.
    console.error(`"${version}" is not a plain major.minor.patch version.`);
    return 1;
  }

  for (const site of SITES) {
    const { text, match } = read(site);
    if (match[2] === version) continue;
    writeFileSync(join(root, site.path), text.replace(site.pattern, `$1${version}$3`));
    console.log(`${site.path}: ${match[2]} → ${version}`);
  }
  return 0;
}

const [mode, argument] = process.argv.slice(2);
if (mode === "check") process.exit(check(argument?.replace(/^v/, "")));
else if (mode === "set" && argument) process.exit(set(argument.replace(/^v/, "")));
else {
  console.error("Usage: node tools/version.mjs check [expected] | set <version>");
  process.exit(2);
}
