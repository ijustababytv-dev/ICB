@echo off
rem Download new or changed Cloudinary images into assets; preserve replaced local files in backups.
cd /d "%~dp0"
call npm.cmd run images:download
set "ICB_DOWNLOAD_EXIT=%ERRORLEVEL%"
echo.
if not "%ICB_DOWNLOAD_EXIT%"=="0" echo Image download failed. Read the error above; rerunning is safe.
pause
exit /b %ICB_DOWNLOAD_EXIT%
