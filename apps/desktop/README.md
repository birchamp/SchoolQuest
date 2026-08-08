# SchoolQuest desktop

The Tauri v2 shell. It wraps the same web app the PWA serves, so there is one interface and one
set of screens — the desktop build exists for the thing a browser is bad at: dropping a stack of
syllabus PDFs onto a window and having them read.

For the other side of this — what a student does with the file the workflow produces — see
[`docs/11-installing-on-windows.md`](../../docs/11-installing-on-windows.md).

## Building a Windows installer

### The way that is known to work

Push a tag, or run the **Windows installer** workflow by hand:

```
gh workflow run desktop-windows.yml -f apiUrl=https://your-worker.workers.dev
```

It builds on a Windows runner and uploads two artifacts:

| File | What it is |
| --- | --- |
| `SchoolQuest_0.1.0_x64-setup.exe` | NSIS installer. Per-user, so it does not ask for admin. |
| `SchoolQuest_0.1.0_x64_en-US.msi` | MSI, for anyone deploying it through group policy. |

Tagging `v*` also attaches both to the GitHub release.

**Per-user, not per-machine**, deliberately: most students are installing onto a laptop the
university administers, and an installer that opens a UAC prompt they cannot answer is an
installer they do not run.

Set the `SCHOOLQUEST_API_URL` repository variable once. A tag push carries no workflow inputs,
so without it a tagged release would build with no API origin — and the workflow fails loudly
rather than shipping that.

### `apiUrl` is not optional in practice

The client reads `VITE_API_URL` **at build time** — Vite inlines it — so the installer is built
against one specific Worker origin. Leave it blank and the app calls its own origin, which for a
packaged desktop build means `tauri://localhost`, and nothing answers there.

That origin has to appear in two places or the app starts and then fails every request: in
`VITE_API_URL`, and in the `connect-src` of `app.security.csp`, which the packaged webview
enforces. A CSP rejection produces no status code and no network entry — it reads as "nothing
loads" — so `scripts/build-config.mjs` derives the CSP from the same URL and the workflow passes
it to `tauri build --config`. A custom API domain now needs no config edit.

The committed CSP keeps `http://127.0.0.1:8787`, `http://localhost:8787` and
`https://*.workers.dev` because `pnpm tauri dev` talks to `wrangler dev` on 8787.

### Releasing a version

The version is declared in four files, and a mismatch is invisible until a student has the wrong
thing installed: a `v0.2.0` tag with `0.1.0` in the manifests publishes
`SchoolQuest_0.1.0_x64-setup.exe`, which Windows offers to *repair* rather than upgrade.

```
pnpm version:set 0.2.0     # package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push --tags
```

The workflow re-checks this against the tag and refuses to build if they disagree.

### Signing, and SmartScreen

An unsigned installer triggers Windows SmartScreen: a blue **"Windows protected your PC"** panel
whose only visible button is *Don't run*.

**SchoolQuest ships unsigned, deliberately, and that is not expected to change.** Code-signing
certificates run a few hundred dollars a year and, since June 2023, require the private key to
live on a hardware token or in a cloud HSM — a recurring cost and a piece of physical hardware
that a free hobby project does not have. Nearly every small open-source Windows application is in
the same position, and pretending a purchase is imminent would be worse than saying so.

What is done instead, because it is what actually helps a cautious student:

- The installer is built by GitHub Actions from a public commit, not on a maintainer's machine, so
  the release page links a build log showing exactly what went in.
- `docs/11-installing-on-windows.md` tells students plainly why the warning appears, offers
  VirusTotal and building from source as checks they can run themselves, and points out that the
  browser version needs no installer at all.

The browser is the real answer for anyone unwilling to click past SmartScreen; the desktop app
exists for dragging syllabus PDFs in, and nothing else depends on it.

If someone does fund a certificate later, the workflow needs two repository secrets and nothing
else changes:

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | The `.pfx`, base64-encoded: `base64 -w0 cert.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Its export password |

With those set, the workflow imports the certificate into the runner's store, passes its
thumbprint to `tauri build --config`, and deletes it afterwards. With them unset every step is
skipped and the build is the unsigned build it is today — the repository is ready to sign, not
waiting to.

Signatures are timestamped against `http://timestamp.digicert.com` (`bundle.windows.timestampUrl`)
so installers already in students' downloads folders stay valid after the certificate expires.

### Building locally

On Windows, with Rust, Node 22 and pnpm:

```
pnpm install
pnpm --filter @schoolquest/desktop tauri build
```

### Cross-compiling from Linux

Possible, and not what the release path uses:

```
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
pnpm --filter @schoolquest/web build
cd apps/desktop && pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

`cargo-xwin` fetches the MSVC headers and import libraries from Microsoft — the manifest at
`https://aka.ms/vs/17/release/channel` and the packages behind it. Any environment that filters
egress will refuse that host, and the failure surfaces as `Failed to setup MSVC CRT` after four
retries rather than as anything about networking.

It is also a weaker claim than it sounds even when it works: it produces a binary that *links*,
and WebView2 and the bundler are the parts most likely to differ between a cross-build and a real
one — which are exactly the parts it exercises least. Use it to find compile errors early. Use
the workflow for anything a person is going to install.

## What the installer does to a fresh Windows machine

Worth knowing, because every one of these is a place a student can get stuck:

- Installs under `%LOCALAPPDATA%`, per user. No UAC prompt — deliberate, since most students are
  installing onto a laptop the university administers.
- Adds a Start menu entry and an Add or Remove Programs entry, so uninstalling is ordinary.
- Installs WebView2 if it is missing, via Microsoft's bootstrapper
  (`bundle.windows.webviewInstallMode`). Windows 11 always has it and current Windows 10 almost
  always does; when it is missing the installer needs a working connection to fetch it. The
  alternative, `offlineInstaller`, embeds the whole ~130 MB runtime into the download to save a
  case that is now rare.
- Does **not** register a URL protocol handler, which is why sign-in asks for a pasted link
  rather than opening the app from the email. Registering `schoolquest://` is more than a
  per-user installer should write to a managed machine, and the paste works everywhere.

## Icons

`src-tauri/icons/` holds the generated set. Regenerate from a single square source with:

```
pnpm --filter @schoolquest/desktop tauri icon path/to/icon.png
```

**`icons/icon.ico` is required for any Windows build**, and its absence is not a cosmetic
problem: `tauri_build::build()` refuses outright with

```
`icons/icon.ico` not found; required for generating a Windows Resource file during tauri-build
```

before a single line of the app compiles. The `tauri icon` command above writes it along with
everything else, so the only way to lose it is to hand-curate the directory.
