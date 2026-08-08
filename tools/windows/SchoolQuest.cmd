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

rem Preflight first. Every check it makes corresponds to something that otherwise appears later
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
