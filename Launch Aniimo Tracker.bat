@echo off
setlocal
set "APP=%~dp0Aniimo Tracker.html"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "Aniimo Tracker" "%EDGE%" --app="file:///%APP:\=/%"
  exit /b
)
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "Aniimo Tracker" "%CHROME%" --app="file:///%APP:\=/%"
  exit /b
)
echo Microsoft Edge or Google Chrome was not found.
echo Open "Aniimo Tracker.html" manually in a modern browser.
pause
