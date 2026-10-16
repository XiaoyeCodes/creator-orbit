$ErrorActionPreference = 'Stop'
$orbitRoot = Split-Path -Parent $PSScriptRoot
$orbitUrl = 'http://127.0.0.1:4173'
try {
    $orbitHealthy = $false
    try { $reply = Invoke-RestMethod "$orbitUrl/api/bootstrap" -TimeoutSec 3; $orbitHealthy = [bool]$reply.token } catch {}
    if (-not $orbitHealthy) {
        $orbitNode = (Get-Command node.exe -ErrorAction Stop).Source
        $orbitData = Join-Path $orbitRoot 'data'
        New-Item -ItemType Directory -Path $orbitData -Force | Out-Null
        Start-Process -FilePath $orbitNode -ArgumentList ('"' + (Join-Path $orbitRoot 'server.cjs') + '"') -WorkingDirectory $orbitRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $orbitData 'server.stdout.log') -RedirectStandardError (Join-Path $orbitData 'server.stderr.log') | Out-Null
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            try { $reply = Invoke-RestMethod "$orbitUrl/api/bootstrap" -TimeoutSec 3; if ($reply.token) { $orbitHealthy = $true; break } } catch {}
        }
    }
    if (-not $orbitHealthy) { throw 'ORBIT could not start. Check data/server.stderr.log.' }
    Start-Process "$orbitUrl/#atlas"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
