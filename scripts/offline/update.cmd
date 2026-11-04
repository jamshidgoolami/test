@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage:  update.cmd ^<install-dir^> [options]
  echo.
  echo   update.cmd C:\NetWatch
  echo.
  echo Run this from the NEW bundle folder and point it at your EXISTING install.
  echo The data folder of the install - data\netwatch.db - is never touched.
  echo.
  echo Options:
  echo   --ignore-running  continue even if something answers on the app port
  echo   --no-build        skip "npm run build"
  echo   --cache ^<dir^>     use another npm cache instead of this bundle's .npm-cache
  exit /b 1
)

node "%~dp0scripts\offline\update.mjs" %*
set "RC=%errorlevel%"
exit /b %RC%
