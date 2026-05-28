$ErrorActionPreference = "Stop"

$healthUrl = "https://localhost:8443/fineract-provider/actuator/health"
$response = & curl.exe --silent --show-error --fail --insecure $healthUrl
if ($LASTEXITCODE -ne 0) {
    throw "Fineract health check failed at $healthUrl"
}

Write-Output $response
