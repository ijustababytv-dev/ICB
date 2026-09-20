@echo off
setlocal
cd /d "%~dp0"
title ICB - Palia Log Bridge

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the Palia log bridge.
  pause
  exit /b 1
)

rem --- stop any previous copy of the bridge so we don't double-count ------
rem (running two copies would tail the same log twice and double every
rem  gained amount, so this window title must stay unique/unchanged)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*palia-log-bridge.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

echo Starting Palia log bridge...
start "Palia Log Bridge" /min cmd /c "node bridge\palia-log-bridge.js"

echo.
echo The bridge is now tailing your Palia.log in the background and will
echo feed ICB the same way Palia Assistant used to. You can close this
echo window - the bridge keeps running in its own minimized window
echo ("Palia Log Bridge"). To stop it, close that window or log off.
echo.
timeout /t 3 /nobreak >nul
endlocal
