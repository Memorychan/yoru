$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force tools | Out-Null
$url = 'https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip'
curl.exe --fail --location --max-time 180 --silent --show-error $url -o tools/redis.zip
if ($LASTEXITCODE -ne 0) { throw 'Redis download failed' }
if ((Get-FileHash tools/redis.zip -Algorithm SHA256).Hash.ToLower() -ne '7c8cebd50347eaa1d9e784da842ed47a4f33394637835531d6614777b950ee85') { throw 'Redis checksum mismatch' }
Expand-Archive -LiteralPath tools/redis.zip -DestinationPath tools/redis -Force
Write-Output 'Portable Redis installed. PostgreSQL is installed with npm dependencies.'
