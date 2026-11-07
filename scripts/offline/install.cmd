@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  NetWatch - offline install for Windows x64
echo ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo         Install 64-bit Node.js 22.12 or newer, then run this again.
  exit /b 1
)

echo [1/4] Checking prerequisites...
node "%~dp0scripts\offline\verify-install.mjs" --stage pre
if errorlevel 1 exit /b 1

echo [2/4] Installing dependencies from the local cache - no internet needed...
call npm ci --offline --no-audit --no-fund --cache "%~dp0.npm-cache"
if errorlevel 1 (
  echo [ERROR] npm ci failed. Read the output above.
  exit /b 1
)

echo [3/4] Building the web UI...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed. Read the output above.
  exit /b 1
)

echo [4/4] Verifying the installation...
node "%~dp0scripts\offline\verify-install.mjs" --stage post
if errorlevel 1 exit /b 1

echo.
echo [DONE] NetWatch installed successfully.
echo.
echo   Start :  npm start
echo   UI    :  http://localhost:8787
echo   Data  :  data\netwatch.db   - kept on every update
echo.
echo   By default the server listens on 127.0.0.1 only. For LAN access:
echo       set HOST=0.0.0.0   and then run  npm start
echo.
echo   Update later: open the NEW bundle folder and run
echo       update.cmd "%CD%"
exit /b 0
