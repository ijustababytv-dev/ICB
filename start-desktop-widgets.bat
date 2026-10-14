@echo off
cd /d "%~dp0desktop-widgets"
title ICB Desktop Widgets

where npm >nul 2>nul
if errorlevel 1 (
  echo  Node.js / npm is needed for ICB Desktop Widgets.
  pause
  exit /b 1
)

rem --- first time only: download Electron (about 100 MB, takes a minute or two) ---
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo  First-time setup: downloading the widget window engine ^(Electron^)...
  echo  This only happens once.
  echo.
  call npm install --no-audit --no-fund
  rem Newer npm blocks Electron's own download step, so fetch the official Electron 33.2.1
  rem zip from GitHub ourselves and unpack it into node_modules\electron\dist.
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo  Downloading Electron itself ^(about 110 MB^)... please wait, no progress bar.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'x64'}; $u = 'https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-' + $arch + '.zip'; $z = Join-Path $env:TEMP 'icb-electron.zip'; Write-Host ('  From: ' + $u); Invoke-WebRequest -UseBasicParsing $u -OutFile $z; Write-Host '  Unpacking...'; if (Test-Path 'node_modules\electron\dist') { Remove-Item 'node_modules\electron\dist' -Recurse -Force }; Expand-Archive $z -DestinationPath 'node_modules\electron\dist' -Force; Set-Content 'node_modules\electron\path.txt' 'electron.exe' -NoNewline; Remove-Item $z; Write-Host '  Done.' } catch { Write-Host ('  ERROR: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
  )
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo  Setup did not finish. Check your internet and run this again.
    echo  If Windows Security / antivirus popped up, it may have blocked electron.exe -
    echo  allow it, then run this again.
    pause
    exit /b 1
  )
)

rem --- start it (it lives in the system tray, bottom right) ---
start "" "node_modules\electron\dist\electron.exe" .
echo  ICB Desktop Widgets is running - look for the pink icon in your system tray.
echo  Control it from ICB Home ^> Desktop Widgets.
timeout /t 4 /nobreak >nul
