<#
.SYNOPSIS
  Installs and starts SchoolQuest. One command, from nothing.

.DESCRIPTION
  Paste this into PowerShell and press Enter:

      irm https://raw.githubusercontent.com/birchamp/SchoolQuest/main/install.ps1 | iex

  It installs anything missing (Node, Git, pnpm), downloads SchoolQuest, sets it up, makes a
  Desktop shortcut, and opens the app.

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

  `Get-Command` reflects the PATH this session actually has — which matters because winget
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
  throw "Node still is not on PATH. Close this window, open a new PowerShell, and run this again — " +
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
  Good "pnpm $(pnpm --version) is installed"
} else {
  Say "    installing pnpm..."
  npm install -g pnpm --silent | Out-Null
  Sync-Path
  if (-not (Have "pnpm")) { throw "pnpm did not install. Try `npm install -g pnpm` by hand." }
  Good "pnpm $(pnpm --version)"
}

# --- 2. The code.
Step "Getting SchoolQuest"

if (Test-Path (Join-Path $Path ".git")) {
  # Updating rather than refusing: running this again is what people do when something looks
  # wrong, and "the folder already exists" is a useless thing to say to them.
  Good "already there — updating it"
  Push-Location $Path
  git pull --ff-only 2>&1 | Out-Null
  Pop-Location
} else {
  if (Test-Path $Path) {
    throw "$Path already exists and is not a SchoolQuest checkout. Move it, or pass -Path somewhere else."
  }
  git clone --quiet $repoUrl $Path
  Good "downloaded to $Path"
}

Set-Location $Path

# --- 3. Dependencies and configuration.
Step "Setting it up (the first time takes a few minutes)"
pnpm install --silent
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
& (Join-Path $Path "tools\windows\create-shortcut.ps1")

# --- 6. Away.
Say ""
Say "  Done." -ForegroundColor Green
Say ""
Say "  SchoolQuest is on your Desktop. Double-click it any time to start."
Say ""
Say "  When it opens, do these three in order — the app will not let you upload a syllabus"
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
