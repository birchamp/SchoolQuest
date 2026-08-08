<#
.SYNOPSIS
  Installs and starts SchoolQuest. One command, from nothing.

.DESCRIPTION
  Paste this into PowerShell and press Enter:

      irm https://raw.githubusercontent.com/birchamp/SchoolQuest/main/install.ps1 | iex

  Or, from inside a clone - it uses the checkout it is sitting in rather than downloading a
  second copy:

      git clone https://github.com/birchamp/SchoolQuest
      cd SchoolQuest
      powershell -ExecutionPolicy Bypass -File install.ps1

  (While the repository was private the first form returned 404, because GitHub answers 404
  rather than 403 for private raw files so that repository names cannot be probed. It is public
  now, so both work.)

  It installs anything missing (Node, Git, pnpm), downloads SchoolQuest if it is not already
  here, sets it up, makes a Desktop shortcut, and opens the app.

  It exists because the alternative was a nine-step checklist, and this is an app for people who
  find multi-step processes costly. Handing that audience a list of commands and calling the
  result "easy to install" would have been a joke at their expense.

  Safe to run again: it updates an existing copy rather than failing, and skips anything already
  installed. Nothing here needs administrator rights.

.PARAMETER Path
  Where to put it. Defaults to a SchoolQuest folder in your user directory.

.PARAMETER NoStart
  Set everything up but do not launch the app at the end.
#>
[CmdletBinding()]
param(
  [string]$Path = (Join-Path $env:USERPROFILE "SchoolQuest"),
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/birchamp/SchoolQuest"

<#
  Windows ships with script execution disabled, and that stops this installer in a place nobody
  would look for it.

  `irm ... | iex` itself is fine - piped text never touches the policy. But `npm` on Windows is
  three files, and PowerShell reaches for npm.ps1 ahead of npm.cmd, so the very first thing this
  script does with npm dies on "running scripts is disabled on this system". The error names
  npm.ps1, so it reads as a broken Node install rather than a Windows default doing its job.

  Process scope needs no administrator rights and lasts only as long as this PowerShell. It can
  still be refused when the policy comes from Group Policy, which is why every npm and pnpm call
  below also names the .cmd explicitly - that path never consults the policy at all. Belt and
  braces, because the failure this prevents is one the user cannot diagnose.
#>
try {
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction Stop
} catch {
  # Group Policy wins over process scope. The .cmd shims below make that survivable.
}

<#
  npm and pnpm by their .cmd, always.

  On Windows both ship a .ps1 alongside the .cmd, and PowerShell prefers the .ps1 - the one that
  the execution policy can veto. Naming the .cmd sidesteps the question entirely.
#>
function Invoke-Cmd($name, $arguments) {
  $exe = Get-Command "$name.cmd" -ErrorAction SilentlyContinue
  if (-not $exe) { $exe = Get-Command $name -ErrorAction SilentlyContinue }
  if (-not $exe) { throw "$name is not on PATH." }
  & $exe.Source @arguments
}

function Say($text) { Write-Host $text }
function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Good($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

Say ""
Say "  SchoolQuest"
Say "  ==========="
Say ""
Say "  This will install SchoolQuest to: $Path"
Say "  It needs no administrator rights and installs nothing outside your user account."
Say ""

<#
  Finding a command means asking the shell, not guessing at file paths.

  `Get-Command` reflects the PATH this session actually has - which matters because winget
  updates PATH for *new* processes, so a freshly installed tool is invisible here until the
  session's own copy of PATH is refreshed. `Sync-Path` below does that, and skipping it is the
  single commonest reason an installer like this fails halfway with "not recognized".
#>
function Have($name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Sync-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Install-With-Winget($id, $friendly) {
  if (-not (Have "winget")) {
    throw "$friendly is not installed, and winget is not available to install it. " +
          "Install $friendly by hand, then run this again."
  }
  Say "    installing $friendly (this takes a minute)..."
  # --silent so it does not stop on a UI prompt; the accept flags stop it stopping on licences.
  winget install -e --id $id --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Sync-Path
  Start-Sleep -Seconds 2
}

# --- 1. The things SchoolQuest is built on.
Step "Checking what is already installed"

if (Have "git") { Good "Git is installed" }
else { Install-With-Winget "Git.Git" "Git"; if (Have "git") { Good "Git installed" } }

if (Have "node") {
  $major = [int]((node --version) -replace "^v" -split "\." | Select-Object -First 1)
  if ($major -ge 22) {
    Good "Node $(node --version) is installed"
  } else {
    Warn "Node $(node --version) is too old; installing a newer one"
    Install-With-Winget "OpenJS.NodeJS.LTS" "Node"
  }
} else {
  Install-With-Winget "OpenJS.NodeJS.LTS" "Node"
}

if (-not (Have "node")) {
  throw "Node still is not on PATH. Close this window, open a new PowerShell, and run this again - " +
        "the installer usually needs a fresh session to be seen."
}
Good "Node $(node --version)"

<#
  pnpm via npm rather than winget.

  Its winget package and the one npm installs can end up as two copies on PATH in an order
  nobody chose, and the resulting "wrong pnpm" failures are miserable to diagnose. npm is
  guaranteed present by this point, having arrived with Node.
#>
if (Have "pnpm") {
  Good "pnpm $(Invoke-Cmd pnpm @('--version')) is installed"
} else {
  Say "    installing pnpm..."
  Invoke-Cmd npm @("install", "-g", "pnpm", "--silent") | Out-Null
  Sync-Path
  # Single quotes: in a double-quoted string the backtick before "npm" is PowerShell's newline
  # escape, so the advice arrived broken across two lines with the "n" eaten.
  if (-not (Have "pnpm")) { throw 'pnpm did not install. Try: npm install -g pnpm' }
  Good "pnpm $(Invoke-Cmd pnpm @('--version'))"
}

# --- 2. The code.
Step "Getting SchoolQuest"

<#
  If this script is sitting inside a checkout, that checkout is the one to use.

  While the repository is private there is no way to fetch this file without cloning first, so
  running it from inside the clone is the normal path rather than the exception - and defaulting
  to a folder in the user profile would quietly make a *second* copy somewhere else, leaving two
  installs, one of them the one they are looking at and the other the one that got set up.

  Piped through `iex` there is no script on disk and $PSScriptRoot is empty, which `Join-Path`
  treats as an error rather than a miss - so the emptiness is checked first, not discovered.
#>
if ($PSScriptRoot -and
    (Test-Path (Join-Path $PSScriptRoot ".git")) -and
    (Test-Path (Join-Path $PSScriptRoot "package.json"))) {
  $Path = $PSScriptRoot
  Good "using the copy this script is in: $Path"
}

if (Test-Path (Join-Path $Path ".git")) {
  # Updating rather than refusing: running this again is what people do when something looks
  # wrong, and "the folder already exists" is a useless thing to say to them.
  Push-Location $Path
  <#
    git reports normal progress on stderr - "From https://github.com/..." is not an error - and
    `2>&1` turns every one of those lines into an ErrorRecord. Under $ErrorActionPreference =
    "Stop" that is a *terminating* error, so a successful pull aborted the installer and printed
    the fetch banner in red as its cause.

    Exit code is the only thing that says whether git succeeded, so that is what gets checked.
  #>
  $ErrorActionPreference = "Continue"
  git pull --ff-only --quiet 2>&1 | Out-String | Out-Null
  $pulled = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  Pop-Location

  if ($pulled -eq 0) {
    Good "already there - updated it"
  } else {
    # Not fatal. A dirty tree or a diverged branch is a good reason not to touch it, and the copy
    # already on disk is almost certainly fine to install from.
    Warn "already there, but could not update it (git exit $pulled) - using it as it is"
  }
} else {
  if (Test-Path $Path) {
    throw "$Path already exists and is not a SchoolQuest checkout. Move it, or pass -Path somewhere else."
  }
  git clone --quiet $repoUrl $Path
  if ($LASTEXITCODE -ne 0) { throw "git clone failed. Check your connection and try again." }
  Good "downloaded to $Path"
}

Set-Location $Path

# --- 3. Dependencies and configuration.
Step "Setting it up (the first time takes a few minutes)"
Invoke-Cmd pnpm @("install", "--silent")
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed. The output above says why." }
Good "dependencies installed"

node tools\setup.mjs
if ($LASTEXITCODE -ne 0) { throw "Setup failed. The output above says why." }

# --- 4. Check before claiming success.
Step "Checking the install"
node tools\preflight.mjs
if ($LASTEXITCODE -ne 0) {
  Warn "Something above needs fixing before SchoolQuest will run."
  Warn "Fix it, then run:  cd `"$Path`"; pnpm dev"
  exit 1
}

# --- 5. The shortcut.
Step "Making a Desktop shortcut"
# Its own PowerShell with -ExecutionPolicy Bypass rather than dot-sourcing it: if the policy came
# from Group Policy the Set-ExecutionPolicy above was refused, and calling this directly would
# fail here - after the install has otherwise completely succeeded.
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile -ExecutionPolicy Bypass `
  -File (Join-Path $Path "tools\windows\create-shortcut.ps1")
if ($LASTEXITCODE -ne 0) { Warn "the shortcut could not be created; everything else is fine" }

# --- 6. Away.
Say ""
# Write-Host directly rather than Say: Say takes one argument, so a -ForegroundColor passed to it
# lands in $args and is silently dropped - no error, just a "Done." that is not green.
Write-Host "  Done." -ForegroundColor Green
Say ""
Say "  SchoolQuest is on your Desktop. Double-click it any time to start."
Say ""
Say "  When it opens, do these three in order - the app will not let you upload a syllabus"
Say "  until the calendar exists, because a syllabus says `"Week 14`" without ever saying when"
Say "  that is:"
Say ""
Say "    1. Setup -> AI and model    paste your OpenRouter key (openrouter.ai/keys)"
Say "    2. Setup -> Semester calendar    term dates, and paste your school's calendar page"
Say "    3. Setup -> Courses, then upload a syllabus"
Say ""

if (-not $NoStart) {
  Say "  Starting it now. Leave the window that opens alone while you use the app."
  Say ""
  Start-Sleep -Seconds 2
  & (Join-Path $Path "tools\windows\SchoolQuest.cmd")
}
