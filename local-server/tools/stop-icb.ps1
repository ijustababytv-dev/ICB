# Stop only the production ICB listener; never terminate every Node process.
$ErrorActionPreference = 'Stop'

try {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq 8790 })
    if ($listeners.Count -eq 0) {
        Write-Host 'ICB Clean is already stopped (port 8790 is free).'
        exit 0
    }

    $serverIds = @($listeners.OwningProcess | Sort-Object -Unique)
    # Validate every listener before stopping any, so an unrelated app stays alone.
    foreach ($serverId in $serverIds) {
        $server = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId"
        if ($server.Name -ne 'node.exe' -or
            $server.CommandLine -notmatch '(?i)(?:^|[\s"\\/])local-server[\\/]src[\\/]index\.js(?:"|\s|$)') {
            throw "Port 8790 belongs to an unrecognized process ($serverId). Nothing was stopped."
        }
    }

    foreach ($serverId in $serverIds) {
        Stop-Process -Id $serverId -ErrorAction Stop
        Write-Host "Stopped ICB Clean process $serverId."
    }

    # Do not report success if a replacement listener has claimed the port.
    $remaining = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq 8790 })
    if ($remaining.Count -gt 0) {
        throw 'Port 8790 is still in use. ICB Clean could not be confirmed stopped.'
    }
    Write-Host 'ICB Clean is stopped (port 8790 is free).'
    exit 0
} catch {
    Write-Host "Could not stop ICB Clean: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
