import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Windows scripts must be pure ASCII.
 *
 * Windows PowerShell 5.1 — still the powershell.exe on every Windows 11 machine — reads a .ps1
 * with no byte-order mark as Windows-1252, not UTF-8. An em dash is UTF-8 `E2 80 94`, and byte
 * `94` in Windows-1252 is `”` U+201D, which PowerShell accepts as a *string delimiter*. So a
 * single em dash inside a double-quoted string silently ends that string early, and the file
 * stops parsing:
 *
 *     Write-Error "Launcher not found at $launcher — is this the SchoolQuest repository?"
 *
 * became an unterminated string and a missing `}`, reported against two other lines. It cost a
 * live install, and nothing in this repository could have caught it: the file is never imported,
 * never linted as TypeScript, and never executed off Windows.
 *
 * ASCII rather than adding a BOM, deliberately. install.ps1 is also fetched and piped through
 * `iex`, where a BOM arrives as a leading U+FEFF in the string being executed. ASCII is the one
 * encoding that is identical in UTF-8 and Windows-1252, so it is correct down every path.
 */
const ROOT = join(import.meta.dirname, "..", "..");

/**
 * Found by glob rather than listed, so a script added later is covered without anyone remembering
 * to add it here. A hard-coded list would have gone stale silently, which is the same failure
 * mode as having no test.
 */
const WINDOWS_SCRIPTS = globSync("**/*.{ps1,psm1,cmd,bat,sh}", {
  cwd: ROOT,
  exclude: (name) => name === "node_modules" || name === "dist" || name === ".git",
}).sort();

describe("Windows scripts", () => {
  it.each(WINDOWS_SCRIPTS)("%s is pure ASCII", (relativePath) => {
    const text = readFileSync(join(ROOT, relativePath), "utf8");

    const offenders = [...text]
      .map((character, index) => ({ character, index }))
      .filter(({ character }) => character.codePointAt(0)! > 0x7f)
      .map(({ character, index }) => {
        const line = text.slice(0, index).split("\n").length;
        const code = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
        return `line ${line}: U+${code} ${JSON.stringify(character)}`;
      });

    expect(offenders, `non-ASCII in ${relativePath} (see this file's header)`).toEqual([]);
  });

  it.each(WINDOWS_SCRIPTS.filter((p) => p.endsWith(".ps1")))(
    "%s has no byte-order mark",
    (relativePath) => {
      // A BOM would fix the encoding problem for files read from disk but break `irm … | iex`,
      // which is the documented way to run install.ps1.
      const bytes = readFileSync(join(ROOT, relativePath));
      expect(bytes.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
    },
  );

  it("finds the scripts it is meant to be checking", () => {
    // Without this, a broken glob would report a cheerful zero failures over zero files.
    expect(WINDOWS_SCRIPTS).toContain("install.ps1");
    expect(WINDOWS_SCRIPTS).toContain("tools/windows/create-shortcut.ps1");
    expect(WINDOWS_SCRIPTS).toContain("tools/windows/SchoolQuest.cmd");
  });

  it.each(WINDOWS_SCRIPTS.filter((p) => p.endsWith(".ps1")))(
    "%s has balanced block comments",
    (relativePath) => {
      // `<#` and `#>` must strictly alternate. An unbalanced pair comments out the rest of the
      // file, which presents as the script doing nothing rather than as an error.
      const delimiters = readFileSync(join(ROOT, relativePath), "utf8").match(/<#|#>/g) ?? [];
      delimiters.forEach((delimiter, index) => {
        expect(delimiter).toBe(index % 2 === 0 ? "<#" : "#>");
      });
      expect(delimiters.length % 2).toBe(0);
    },
  );
});
