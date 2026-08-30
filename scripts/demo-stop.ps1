$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
docker compose down
Write-Host 'Local services stopped. Demo data remains in the Docker volume.' -ForegroundColor Green
