param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$orbitRoot = Split-Path -Parent $PSScriptRoot
$orbitUrl = 'http://127.0.0.1:4173'
try {
    $orbitHealthy = $false
    $orbitFreePort = $null
    # Reuse the current workspace version. Leave older services untouched.
    foreach ($orbitCandidate in 4173..4182) {
        $orbitCandidateUrl = "http://127.0.0.1:$orbitCandidate"
        $orbitLegacyBusy = $false
        try {
            $reply = Invoke-RestMethod "$orbitCandidateUrl/api/bootstrap" -TimeoutSec 2
            if ($reply.token -and $reply.workspaceVersion -eq 2 -and $reply.studioVersion -eq 3) {
                $orbitUrl = $orbitCandidateUrl
                $orbitHealthy = $true
                break
            }
            if ($reply.token -and @($reply.jobs | Where-Object { $_.status -in @('queued', 'generating', 'reviewing', 'validating') }).Count -gt 0) {
                $orbitLegacyBusy = $true
            }
            if ($reply.token -and $reply.studioVersion -ge 1) {
                # Studio jobs share persisted files across local versions too.
                # If their state cannot be read, do not start a competing service.
                $orbitLegacyBusy = $true
                $orbitStudioReply = Invoke-RestMethod "$orbitCandidateUrl/api/studio/jobs" -TimeoutSec 15
                $orbitLegacyBusy = @($reply.jobs | Where-Object { $_.status -in @('queued', 'generating', 'reviewing', 'validating') }).Count -gt 0 -or @($orbitStudioReply | Where-Object { $_.status -in @('queued', 'generating', 'validating') }).Count -gt 0
            }
        } catch {}
        if ($orbitLegacyBusy) { throw 'An older workspace is still generating. Wait for it to finish before opening the updated workspace.' }
        if (-not $orbitFreePort -and -not (Get-NetTCPConnection -LocalPort $orbitCandidate -State Listen -ErrorAction SilentlyContinue)) {
            $orbitFreePort = $orbitCandidate
        }
    }
    if (-not $orbitHealthy) {
        if (-not $orbitFreePort) { throw 'No free local workspace port (4173-4182).' }
        $orbitUrl = "http://127.0.0.1:$orbitFreePort"
        $orbitNode = (Get-Command node.exe -ErrorAction Stop).Source
        $orbitData = Join-Path $orbitRoot 'data'
        New-Item -ItemType Directory -Path $orbitData -Force | Out-Null
        $orbitOriginalPort = $env:ORBIT_PORT
        try {
            $env:ORBIT_PORT = [string]$orbitFreePort
            Start-Process -FilePath $orbitNode -ArgumentList ('"' + (Join-Path $orbitRoot 'server.cjs') + '"') -WorkingDirectory $orbitRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $orbitData "server-$orbitFreePort.stdout.log") -RedirectStandardError (Join-Path $orbitData "server-$orbitFreePort.stderr.log") | Out-Null
        } finally { $env:ORBIT_PORT = $orbitOriginalPort }
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            try { $reply = Invoke-RestMethod "$orbitUrl/api/bootstrap" -TimeoutSec 3; if ($reply.token -and $reply.workspaceVersion -eq 2 -and $reply.studioVersion -eq 3) { $orbitHealthy = $true; break } } catch {}
        }
    }
    if (-not $orbitHealthy) { throw 'ORBIT could not start. Check data/server.stderr.log.' }
    Start-Process "$orbitUrl/#atlas"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $Quiet) { Read-Host 'Press Enter to close' }
    exit 1
}
