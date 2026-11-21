# Rebuilds the school_pilot database from scratch: schema -> defaults -> seed (regenerated for today's date).
# Usage:  powershell -File database\rebuild.ps1 [-Date 2026-12-10]
# Stop the backend first if it holds connections (the script force-drops the database).
param([string]$Date = "")

$ErrorActionPreference = "Stop"
$pg = "C:\Program Files\PostgreSQL\18\bin"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PGPASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "postgres" }
$env:PGCLIENTENCODING = "UTF8"   # without this Arabic text is garbled on Windows

Write-Host "Generating seed..."
if ($Date) { python "$here\generate_seed.py" $Date | Out-Null } else { python "$here\generate_seed.py" | Out-Null }
if ($LASTEXITCODE -ne 0) { throw "generate_seed.py failed" }

& "$pg\dropdb.exe" -U postgres --force --if-exists school_pilot
& "$pg\createdb.exe" -U postgres -E UTF8 school_pilot
foreach ($f in "schema", "defaults", "seed") {
  Write-Host "Loading $f.sql..."
  & "$pg\psql.exe" -U postgres -d school_pilot -v ON_ERROR_STOP=1 -q -f "$here\$f.sql" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$f.sql failed" }
}
Write-Host "Done. Demo accounts use the password Test@1234 (see README)."
