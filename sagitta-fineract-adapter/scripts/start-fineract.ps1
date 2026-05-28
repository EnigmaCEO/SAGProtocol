$ErrorActionPreference = "Stop"

$fineractRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\Fineract")).Path
$installedPlugins = docker plugin ls --format "{{.Name}}"
if ($installedPlugins -notcontains "loki:latest") {
    throw "The official development compose file requires the Loki Docker plugin. Run: docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions"
}

if (-not $env:FINERACT_USER) {
    $env:FINERACT_USER = "1000"
}
if (-not $env:FINERACT_GROUP) {
    $env:FINERACT_GROUP = "1000"
}

Push-Location $fineractRepo
try {
    docker compose -f docker-compose-development.yml up -d
}
finally {
    Pop-Location
}
