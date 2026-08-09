@echo off
setlocal
rem SchoolQuest launcher - what the desktop shortcut actually runs.
rem
rem A double-clicked shortcut has to survive the two things a terminal user works around without
rem thinking: it starts in some unrelated directory, and it vanishes the instant anything fails.
rem So this pins itself to the repository regardless of where Windows launched it, and holds the
rem window open on every exit path - a console that closes on error takes the error with it, and
rem the only thing left is an icon that "does nothing".

rem %~dp0 is this file's own folder, so the repo is two levels up wherever it has been copied to.
cd /d "%~dp0..\.."

title SchoolQuest

echo.
echo   SchoolQuest
echo   -----------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node is not installed, or not on PATH.
  echo.
  echo   Install Node 22 or newer from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo   pnpm is not installed.
  echo.
  echo   Open PowerShell and run:  npm install -g pnpm
  echo.
  pause
  exit /b 1
)

rem --- Update first, but never at the cost of the data or of starting at all. -----------------
rem
rem Your work is not in git and cannot be touched by an update: the database lives in
rem apps\api\.wrangler and your key and AUTH_SECRET live in apps\api\.dev.vars, and .gitignore
rem excludes both. A pull only ever replaces code.
rem
rem Everything below is best-effort. No network, a dirty tree, a failed install - none of them
rem stop the app. Someone double-clicking this wants to work, and "could not reach GitHub" is
rem not a reason to refuse to open the copy already sitting on the disk.
rem
rem Pass --no-update to skip it entirely.
if /i "%~1"=="--no-update" goto :after_update

where git >nul 2>&1
if errorlevel 1 goto :after_update

rem Local edits mean this is somebody's working copy, so leave it completely alone rather than
rem deciding for them what happens to their changes.
git diff --quiet 2>nul
if errorlevel 1 (
  echo   Local changes found - leaving this copy as it is.
  echo.
  goto :after_update
)

for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "BEFORE=%%h"

echo   Checking for a newer version...
rem --ff-only so it can only ever fast-forward: no merge commit, no conflict to resolve, and
rem nothing that could leave the checkout in a state needing git knowledge to get out of.
git pull --ff-only --quiet 2>nul
if errorlevel 1 (
  echo   Could not check ^(no connection, most likely^). Starting the copy you have.
  echo.
  goto :after_update
)

for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "AFTER=%%h"
if "%BEFORE%"=="%AFTER%" (
  echo   Already up to date.
  echo.
  goto :after_update
)

echo   Updated. Installing anything new...
call pnpm install --silent
if errorlevel 1 (
  echo.
  echo   Dependencies did not install. Run this by hand and read the output:
  echo       cd /d "%CD%"
  echo       pnpm install
  echo.
  pause
  exit /b 1
)

rem New code can expect new database columns, and applying migrations is additive and tracked -
rem already-applied ones are skipped. Skipping this step is what turns an update into the
rem "no such column" error that reads as the app being broken.
echo   Updating the database...
call pnpm --filter @schoolquest/api db:migrate:local
if errorlevel 1 (
  echo.
  echo   The database could not be updated, so the app would fail in confusing ways.
  echo   Run this and read the output:  pnpm setup
  echo.
  pause
  exit /b 1
)
echo.

:after_update

rem Preflight. Every check it makes corresponds to something that otherwise appears later
rem wearing a disguise - a busy port looks like the app failing to start, an unmigrated database
rem looks like a server crash. Better to stop here with an instruction than to start and confuse.
echo   Checking...
echo.
call node tools\preflight.mjs
if errorlevel 1 (
  echo.
  echo   Fix the items marked with an X above, then run this again.
  echo   Most of them are fixed by:  pnpm setup
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting. A browser will open by itself in a few seconds.
echo   Leave this window open while you use SchoolQuest; closing it stops the app.
echo.

call node tools\dev.mjs --open

rem Reached when the app stops, whether by Ctrl-C or by crashing. The pause is the whole point:
rem without it a crash closes the window and its own explanation together.
echo.
echo   SchoolQuest has stopped.
echo.
pause
