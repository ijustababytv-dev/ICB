@echo off
setlocal
title ICB Clean - Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\tools\stop-icb.ps1"
set "STOP_RESULT=%ERRORLEVEL%"
if not "%~1"=="--no-pause" pause
exit /b %STOP_RESULT%
