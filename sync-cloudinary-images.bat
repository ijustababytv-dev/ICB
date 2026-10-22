@echo off
rem Upload only new or changed project images; keep local originals and remote-only files.
cd /d "%~dp0"
call npm.cmd run images:sync
set "ICB_SYNC_EXIT=%ERRORLEVEL%"
echo.
if not "%ICB_SYNC_EXIT%"=="0" echo Image sync failed. Read the error above; rerunning is safe.
pause
exit /b %ICB_SYNC_EXIT%
