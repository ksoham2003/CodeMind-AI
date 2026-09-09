# Self-healing port-forward for CodeMind AI
# Only forwards the CLIENT port — Nginx inside the client container
# proxies /api/ and /socket.io/ to the server internally.
# NO separate server port-forward is needed.

$Namespace = "codemind"
$ClientPort = "8081:80"

function Start-Forward {
    param($Svc, $Ports)
    Write-Host "[$(Get-Date -f 'HH:mm:ss')] Starting port-forward: $Svc $Ports"
    return Start-Process kubectl -ArgumentList "port-forward svc/$Svc $Ports -n $Namespace" -PassThru -WindowStyle Hidden
}

$clientJob = Start-Forward "codemind-client" $ClientPort

Write-Host ""
Write-Host "==================================="
Write-Host " CodeMind AI port-forward is LIVE"
Write-Host "   App: http://localhost:8081"
Write-Host ""
Write-Host " (API is proxied via Nginx at /api)"
Write-Host "==================================="
Write-Host " Press Ctrl+C to stop."
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 10

        if ($clientJob.HasExited) {
            Write-Host "[$(Get-Date -f 'HH:mm:ss')] Client port-forward dropped. Reconnecting..."
            Start-Sleep -Seconds 2
            $clientJob = Start-Forward "codemind-client" $ClientPort
        }
    }
} finally {
    Write-Host "Stopping port-forwards..."
    if (-not $clientJob.HasExited) { $clientJob.Kill() }
}
