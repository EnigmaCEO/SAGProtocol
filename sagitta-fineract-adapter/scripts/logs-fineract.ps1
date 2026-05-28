$ErrorActionPreference = "Stop"

$fineractRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\Fineract")).Path
$logDirectory = Join-Path $fineractRepo "build\fineract\logs"
$latestLog = Get-ChildItem -Path $logDirectory -Filter "fineract*.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($latestLog) {
    Get-Content -Path $latestLog.FullName -Tail 100 -Wait
    exit
}

if (-not $env:FINERACT_USER) {
    $env:FINERACT_USER = "1000"
}
if (-not $env:FINERACT_GROUP) {
    $env:FINERACT_GROUP = "1000"
}

Push-Location $fineractRepo
try {
    docker compose -f docker-compose-development.yml logs --follow fineract
}
finally {
    Pop-Location
}
