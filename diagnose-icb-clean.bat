@echo off
setlocal
powershell -NoProfile -Command "try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 3; $state=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/state' -TimeoutSec 3; $diag=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/diagnostics' -TimeoutSec 3; Write-Host ''; Write-Host ('Service: ' + $health.service); Write-Host ('Version: ' + $health.version); Write-Host ('Port: ' + $health.port); Write-Host ('Reader: ' + $state.live.reader.state); Write-Host ('Needs reconciliation: ' + $state.live.reconciliation.required); Write-Host ('Palia log: ' + $diag.reader.file); Write-Host ''; exit 0 } catch { Write-Host ''; Write-Host 'ICB Clean is not responding on http://127.0.0.1:8790'; Write-Host 'Run start-icb-clean.bat, then try again.'; Write-Host ''; exit 1 }"
pause
endlocal
