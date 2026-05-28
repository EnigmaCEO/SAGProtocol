$ErrorActionPreference = "Stop"

$fineractRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\Fineract")).Path
if (-not $env:FINERACT_USER) {
    $env:FINERACT_USER = "1000"
}
if (-not $env:FINERACT_GROUP) {
    $env:FINERACT_GROUP = "1000"
}

Push-Location $fineractRepo
try {
    docker compose -f docker-compose-development.yml down
}
finally {
    Pop-Location
}
