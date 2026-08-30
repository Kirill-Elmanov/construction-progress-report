$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' was not found. $InstallHint"
  }
}

Require-Command 'node' 'Install Node.js LTS: https://nodejs.org/en/download'
Require-Command 'pnpm' 'Run: npm install --global pnpm@9.12.0'
Require-Command 'docker' 'Install and start Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/'

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created local .env from the safe example.' -ForegroundColor Green
}

Write-Host 'Starting PostgreSQL and local object storage...' -ForegroundColor Cyan
docker compose up -d

$databaseReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  docker compose exec -T postgres pg_isready -U rost -d rost_report *> $null
  if ($LASTEXITCODE -eq 0) {
    $databaseReady = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $databaseReady) {
  throw 'PostgreSQL was not ready in 60 seconds. Check Docker Desktop.'
}

Write-Host 'Installing dependencies...' -ForegroundColor Cyan
pnpm install --frozen-lockfile

Write-Host 'Applying migrations and creating fictional demo data...' -ForegroundColor Cyan
pnpm db:deploy
pnpm db:seed:demo

Write-Host ''
Write-Host 'Demo is ready:' -ForegroundColor Green
Write-Host '  Application: http://localhost:3000'
Write-Host '  API health: http://localhost:3001/health'
Write-Host '  Login: demo.admin@example.test'
Write-Host '  Password: DemoPassword123!'
Write-Host ''
Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor Yellow

pnpm dev
