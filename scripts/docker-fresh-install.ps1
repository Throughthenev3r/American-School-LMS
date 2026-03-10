# LMS — чистая установка в Docker PostgreSQL
# Запуск: .\scripts\docker-fresh-install.ps1
# Или: powershell -ExecutionPolicy Bypass -File scripts\docker-fresh-install.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "LMS: чистая установка" -ForegroundColor Cyan
Write-Host ""

# 1. Запуск контейнера
Set-Location $ProjectRoot
Write-Host "[1/4] Запуск PostgreSQL (Docker)..." -ForegroundColor Yellow
docker-compose up -d
Start-Sleep -Seconds 5

# 2. Применение схемы и миграций
Write-Host "[2/4] Применение схемы и данных..." -ForegroundColor Yellow
$BackendDb = Join-Path $ProjectRoot "backend\db"
Get-Content "$BackendDb\schema.sql" -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content "$BackendDb\init-all.sql" -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content "$BackendDb\document-chunks.sql" -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content "$BackendDb\seed.sql" -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school

# 3. pgvector + embedding
Write-Host "[3/4] Включение pgvector..." -ForegroundColor Yellow
docker exec -i lms-postgres psql -U postgres -d lms_school -c "CREATE EXTENSION IF NOT EXISTS vector; ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);"

# 4. Seed auth
Write-Host "[4/4] Создание пользователей (seed-auth)..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lms_school"
Set-Location (Join-Path $ProjectRoot "backend")
npm run seed-auth

Write-Host ""
Write-Host "Готово." -ForegroundColor Green
Write-Host "Добавьте в backend/.env:" -ForegroundColor Cyan
Write-Host "  DATABASE_URL=postgres://postgres:postgres@localhost:5433/lms_school"
Write-Host ""
   Write-Host "Login: admin@school.com / admin123" -ForegroundColor Gray