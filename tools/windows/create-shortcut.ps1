<#
.SYNOPSIS
  Puts a SchoolQuest shortcut on the Desktop (and optionally the Start Menu).

.DESCRIPTION
  Run once, after `pnpm setup`:

      powershell -ExecutionPolicy Bypass -File tools\windows\create-shortcut.ps1

  Why a script rather than "make a shortcut yourself": a working shortcut needs four fields set
  correctly - target, arguments, working directory and icon - and getting the working directory
  wrong is the common mistake. It produces a shortcut that launches, fails to find the project,
  and closes, which reads as the app being broken rather than the shortcut being wrong. The
  launcher pins its own directory too, so this is belt and braces on the field most often missed.

  Creating a .lnk needs the WScript.Shell COM object; there is no native cmdlet for it.

.PARAMETER StartMenu
  Also add it to the Start Menu, so it appears when you type "schoolquest".

.PARAMETER Remove
  Delete the shortcuts instead of creating them.
#>
[CmdletBinding()]
param(
  [switch]$StartMenu,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

# This script lives in tools\windows, so the repository is two levels up - resolved rather than
# assumed, so the shortcut keeps working if the project is moved and this is re-run.
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$launcher = Join-Path $PSScriptRoot "SchoolQuest.cmd"
$icon = Join-Path $repo "apps\desktop\src-tauri\icons\icon.ico"

$targets = @([Environment]::GetFolderPath("Desktop"))
if ($StartMenu) {
  $targets += Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
}

if ($Remove) {
  foreach ($dir in $targets) {
    $path = Join-Path $dir "SchoolQuest.lnk"
    if (Test-Path $path) {
      Remove-Item $path -Force
      Write-Host "  removed  $path"
    }
  }
  Write-Host "`nDone.`n"
  exit 0
}

if (-not (Test-Path $launcher)) {
  Write-Error "Launcher not found at $launcher - is this the SchoolQuest repository?"
}

$shell = New-Object -ComObject WScript.Shell

foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) {
    Write-Host "  skipped  $dir (does not exist)"
    continue
  }

  $path = Join-Path $dir "SchoolQuest.lnk"
  $link = $shell.CreateShortcut($path)

  # cmd.exe /c rather than the .cmd directly: launched straight, a .cmd inherits whatever console
  # window Explorer hands it, and the title and pause behaviour become unreliable.
  $link.TargetPath = "$env:ComSpec"
  $link.Arguments = "/c `"$launcher`""

  # The field people get wrong. Without it the shortcut starts wherever Explorer felt like.
  $link.WorkingDirectory = $repo

  $link.Description = "Start SchoolQuest and open it in your browser"
  if (Test-Path $icon) { $link.IconLocation = $icon }
  $link.Save()

  Write-Host "  created  $path"
}

Write-Host ""
Write-Host "Double-click SchoolQuest on your Desktop to start it."
Write-Host "It checks itself first, then opens your browser. Leave the black window open while you use it."
Write-Host ""
