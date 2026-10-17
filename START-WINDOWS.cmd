@echo off
setlocal
cd /d "%~dp0"
set "SECONDLOOK_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined SECONDLOOK_NODE set "SECONDLOOK_NODE=%%N"
if not defined SECONDLOOK_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "SECONDLOOK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined SECONDLOOK_NODE (
  echo Node.js 22.13 or later is required. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\@mastra\core\package.json" (
  echo First install the dependencies and prepare the model as described in README.md.
  pause
  exit /b 1
)
set "SECONDLOOK_OFFLINE=1"
echo SecondLook will run only on this computer in offline mode.
echo After the ready message, open http://127.0.0.1:4173/ in your browser.
echo Keep this window open while reviewing. Press Ctrl+C to stop.
echo.
"%SECONDLOOK_NODE%" src/server.js
if errorlevel 1 pause
