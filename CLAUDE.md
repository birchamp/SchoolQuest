# SchoolQuest working notes

## ASCII only in shell, PowerShell, and batch files

`install.ps1`, `tools/windows/*.ps1` and `tools/windows/*.cmd` must be **pure ASCII, string
literals included**. This is enforced by `tools/windows/encoding.test.ts`.

Windows PowerShell 5.1 reads a `.ps1` with no byte-order mark as Windows-1252. An em dash is UTF-8
`E2 80 94`; byte `94` in Windows-1252 is U+201D, which PowerShell accepts as a **string
delimiter**. One em dash inside a double-quoted string ends that string in the middle of itself
and the file stops parsing, reporting errors against unrelated lines. That cost a live install.

Do not fix it with a BOM: a BOM breaks the first line of a `.cmd`, and `install.ps1` is documented
as `irm ... | iex`, where a BOM arrives as a leading U+FEFF in the executed string.

Use `--` for an em dash, `...` for an ellipsis, `->` for an arrow.

Markdown, TypeScript and JSON are UTF-8 by contract and may contain whatever prose needs.

## Windows scripts are invisible to the normal checks

They are never imported, never type-checked, and never executed on CI. Three separate Windows-only
bugs have come from that blind spot -- a missing `.ico`, the execution policy blocking `npm.ps1`,
and the encoding bug above. Anything touching them needs either a real test or a run on Windows.
"Lint and tests pass" says nothing about them.

Related, same lesson: `pnpm`/`npm` invoked from PowerShell resolve to the `.ps1` shim, which the
execution policy can veto. Call the `.cmd` explicitly. From Node, `spawn`/`execFileSync` need
`shell: true` on Windows to find `pnpm.cmd` at all.

## Verify a guard fails before trusting it

A test written for a bug that has already been fixed passes whether or not it works. Reintroduce
the fault, watch the test fail, then restore. Applies to the encoding test and to anything else
added in response to a live failure.
