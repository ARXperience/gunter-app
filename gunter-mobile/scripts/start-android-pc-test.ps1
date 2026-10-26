param(
    [ValidateRange(1024, 65535)][int]$Port = 3002,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 3013) { throw 'El puerto 3013 pertenece al laboratorio visual, no al backend Android.' }
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$nodeCommand = Get-Command node -ErrorAction Stop
$serverFile = Join-Path $repositoryRoot 'server.js'
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'node_modules') -PathType Container)) {
    throw 'Faltan server.js o las dependencias. Revisa npm ci antes de iniciar; este script no instala nada.'
}
$listenerCommand = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
if ($null -eq $listenerCommand) { throw 'No puedo comprobar el puerto de Windows de forma segura. No inicié el servidor.' }
$occupied = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
$testDataRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'data/android-pc-test'))
Write-Output "Pruebas Android por USB: http://127.0.0.1:$Port"
Write-Output "Datos independientes y privados: $testDataRoot"
Write-Output "Puerto ocupado: $occupied. No se detiene ni reinicia otro proceso."
if (-not $Start) {
    Write-Output 'Sólo comprobación: no se creó almacenamiento ni se inició el servidor. Usa -Start cuando quieras arrancar esta instancia de pruebas.'
    return
}
if ($occupied) { throw 'El puerto está ocupado. No se inició otra instancia ni se cerró el servidor existente.' }

# Only this foreground child receives the development settings. No .env edits,
# persistent OS environment changes, firewall changes, secrets in arguments or
# access to the normal account/session/WhatsApp data directories.
$settings = @{
    NODE_ENV = 'development'
    PORT = [string]$Port
    GUNTER_LISTEN_HOST = '127.0.0.1'
    ALLOWED_ORIGINS = "http://127.0.0.1:$Port"
    AUTH_COOKIE_SECURE = 'false'
    TRUST_PROXY = 'false'
    GUNTER_REPLICAS = '1'
    GUNTER_DISABLE_BACKUPS = 'true'
    GUNTER_DATA_DIR = $testDataRoot
    GUNTER_AUTH_DATA_DIR = (Join-Path $testDataRoot 'auth')
    GUNTER_CONTROL_DATA_DIR = (Join-Path $testDataRoot 'control-plane')
    GUNTER_WHATSAPP_DATA_DIR = (Join-Path $testDataRoot 'whatsapp-data')
    GUNTER_WHATSAPP_SESSION_DIR = (Join-Path $testDataRoot 'whatsapp-session')
    GUNTER_BACKUP_DIR = (Join-Path $testDataRoot 'backups')
}
$previousEnvironment = @{}
try {
    foreach ($key in $settings.Keys) {
        $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    Push-Location -LiteralPath $repositoryRoot
    try {
        Write-Output 'Iniciando sólo el backend de pruebas en loopback. Ctrl+C detiene esta instancia; no publica el PC en la red.'
        & $nodeCommand.Source $serverFile
        if ($LASTEXITCODE -ne 0) { throw "La instancia de pruebas terminó con código $LASTEXITCODE." }
    } finally { Pop-Location }
} finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
}
