@echo off
rem One-click launcher: starts the Palia log bridge (which replaces Palia
rem Assistant as ICB's data source) and then starts ICB Clean itself.
setlocal
cd /d "%~dp0"
call "%~dp0start-palia-bridge.bat"
call "%~dp0start-icb-clean.bat"
endlocal
