@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title ICB Clean - Restart

echo.
echo  ICB CLEAN - RESTART
echo  ===================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is required for ICB Clean.
  pause
  exit /b 1
)

rem --- stop whatever is already holding port 8790 -------------------------
set "FOUND="
echo  Looking for an existing server on port 8790...
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /R /C:":8790 .*LISTENING"') do (
  if not "%%P"=="0" (
    set "FOUND=1"
    echo  Stopping old server, process %%P
    taskkill /F /PID %%P >nul 2>nul
  )
)
if defined FOUND (
  echo  Old server stopped.
  timeout /t 2 /nobreak >nul
) else (
  echo  Nothing was running.
)

rem --- start the new one --------------------------------------------------
echo  Starting ICB Clean...
start "ICB Clean Server" /min cmd /c "node local-server\src\index.js"

for /l %%N in (1,1,25) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8790/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch {} ; exit 1" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo.
echo  ICB Clean did not come up on port 8790.
echo  Check the "ICB Clean Server" window for an error.
pause
exit /b 1

:ready
echo.
echo  READY - ICB Clean is live on port 8790.
echo.

set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
rem --- open ICB Home + every page ticked "Open when ICB starts" -----------
rem (ICB Home, 2026-09-29: the list comes from hub.html's checkboxes)
set "START_URLS=http://127.0.0.1:8790/hub.html"
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "try { ((Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 http://127.0.0.1:8790/api/hub/startup-urls).urls) -join ' ' } catch { 'http://127.0.0.1:8790/hub.html' }"`) do set "START_URLS=%%U"
if defined CHROME_EXE start "ICB Home" "%CHROME_EXE%" !START_URLS!
if not defined CHROME_EXE for %%U in (!START_URLS!) do start "" "%%U"

echo  ICB Home opened. You can close this window.
timeout /t 4 /nobreak >nul
endlocal
