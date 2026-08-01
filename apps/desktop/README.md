# SchoolQuest desktop

The Tauri v2 shell. It wraps the same web app the PWA serves, so there is one interface and one
set of screens — the desktop build exists for the thing a browser is bad at: dropping a stack of
syllabus PDFs onto a window and having them read.

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

Two things have to agree or the app will start and then fail every request:

1. `apiUrl` in the workflow input, and
2. `app.security.csp` in `tauri.conf.json`, whose `connect-src` currently allows
   `http://127.0.0.1:8787`, `http://localhost:8787` and `https://*.workers.dev`.

A custom domain for the API means editing the CSP too. The failure looks like a network error
with no explanation, because a CSP violation is not an HTTP status.

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

## Icons

`src-tauri/icons/` holds the generated set. Regenerate from a single square source with:

```
pnpm --filter @schoolquest/desktop tauri icon path/to/icon.png
```
