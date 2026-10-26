param(
    [string]$AdbPath,
    [ValidateRange(1024, 65535)][int]$Port = 3002,
    [string]$Serial,
    [switch]$Connect,
    [switch]$Disconnect
)
$ErrorActionPreference = 'Stop'

# PowerShell 7+. DEFAULT: read-only preflight; no adb process or daemon starts.
# -Connect is an explicit opt-in to adb devices + one selected reverse mapping.
# adb itself may start its normal local daemon after that explicit opt-in.
# No APK installation, permission grants, server startup or global cleanup.
# Official command reference:
# https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/user/adb.1.md

if ($Connect -and $Disconnect) { throw 'Elige solamente -Connect o -Disconnect.' }
if ($Port -eq 3013) { throw 'El puerto 3013 está reservado al laboratorio visual; no se permite para esta prueba Android.' }
if ($Serial -and ($Serial.Length -gt 128 -or $Serial -notmatch '^[A-Za-z0-9_.:-]+$')) {
    throw 'El identificador indicado no tiene un formato ADB válido.'
}

function Resolve-ExistingAdb {
    param([string]$ExplicitPath)
    if ($ExplicitPath) {
        $candidate = Get-Item -LiteralPath $ExplicitPath -ErrorAction SilentlyContinue
        if (-not $candidate -or $candidate.PSIsContainer -or $candidate.Name -ine 'adb.exe') {
            throw '-AdbPath debe apuntar a un adb.exe existente de Android SDK Platform-Tools.'
        }
        return $candidate.FullName
    }
    $sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
    if ($env:USERPROFILE) { $sdkRoots += Join-Path $env:USERPROFILE 'AppData/Local/Android/Sdk' }
    foreach ($sdkRoot in ($sdkRoots | Where-Object { $_ } | Select-Object -Unique)) {
        $candidate = Get-Item -LiteralPath (Join-Path $sdkRoot 'platform-tools/adb.exe') -ErrorAction SilentlyContinue
        if ($candidate -and -not $candidate.PSIsContainer) { return $candidate.FullName }
    }
    return $null
}

function Test-PcHealth {
    param([int]$TestPort)
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $response = $null
    try {
        # Read headers/status only; do not retrieve account records or print a body.
        $response = $client.GetAsync("http://127.0.0.1:$TestPort/api/health", [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        return [int]$response.StatusCode
    } catch { return $null }
    finally {
        if ($response) { $response.Dispose() }
        $client.Dispose()
        $handler.Dispose()
    }
}

function Invoke-ScopedAdb {
    param([string]$Executable, [string[]]$AdbArguments)
    # This guard remains inside the execution function as well as the entrypoint.
    if (-not ($Connect -or $Disconnect)) { throw 'ADB requiere -Connect o -Disconnect explícito.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-H', '127.0.0.1', '-P', '5037') + $AdbArguments) { $start.ArgumentList.Add($argument) }
    # Pin the local ADB host/port and avoid inherited diagnostic output/selection.
    foreach ($name in @('ADB_TRACE', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_PORT', 'ANDROID_SERIAL')) { [void]$start.Environment.Remove($name) }
    $start.Environment['ADB_MDNS_AUTO_CONNECT'] = '0'
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'ADB no pudo iniciarse.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(10000)) {
            # Stop only this owned client, not an existing/shared ADB server.
            $process.Kill()
            $process.WaitForExit()
            throw 'ADB agotó el tiempo de espera; revisa el cable y la autorización del teléfono.'
        }
        $text = $stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'ADB no completó la operación. Comprueba la conexión USB y la autorización del teléfono.' }
        return $text
    } finally { $process.Dispose() }
}

function Select-AuthorizedDevice {
    param([string]$DeviceOutput, [string]$RequestedSerial)
    $devices = @()
    foreach ($line in ($DeviceOutput -split '\r?\n')) {
        if ($line -match '^([^\s]+)\s+(device|unauthorized|offline|recovery|sideload|bootloader|rescue)(?:\s|$)') {
            $devices += [pscustomobject]@{ DeviceSerial = $Matches[1]; State = $Matches[2] }
        }
    }
    if ($RequestedSerial) {
        $selected = @($devices | Where-Object { $_.DeviceSerial -ceq $RequestedSerial })
        if ($selected.Count -ne 1) { throw 'El dispositivo indicado no está conectado o no se puede seleccionar de forma inequívoca.' }
    } else {
        if ($devices.Count -gt 1) { throw 'Hay varios dispositivos. Repite con -Serial explícito; este asistente no imprime identificadores.' }
        if ($devices.Count -eq 0) { throw 'No hay dispositivos ADB conectados. Conecta el teléfono por USB y habilita depuración USB.' }
        $selected = @($devices[0])
    }
    if ($selected[0].State -cne 'device') { throw 'El dispositivo aún no está autorizado o disponible. Desbloquéalo y acepta personalmente la depuración USB.' }
    return $selected[0].DeviceSerial
}

function Get-SelectedMappings {
    param([string]$Executable, [string]$SelectedSerial)
    $listing = Invoke-ScopedAdb -Executable $Executable -AdbArguments @('-s', $SelectedSerial, 'reverse', '--list')
    $mappings = @()
    foreach ($line in ($listing -split '\r?\n')) {
        $parts = @($line.Trim() -split '\s+')
        if ($parts.Count -ge 2) {
            $mappings += [pscustomobject]@{ DeviceSocket = $parts[-2]; PcSocket = $parts[-1] }
        }
    }
    return $mappings
}

$adb = Resolve-ExistingAdb -ExplicitPath $AdbPath
$healthStatus = Test-PcHealth -TestPort $Port
$phoneUrl = "http://127.0.0.1:$Port"
if (-not ($Connect -or $Disconnect)) {
    [pscustomobject]@{
        Mode = 'PREFLIGHT_ONLY'
        Port = $Port
        AdbAvailable = [bool]$adb
        PcHealthHttpStatus = $healthStatus
        ReadyForExplicitConnect = [bool]($adb -and $healthStatus -eq 200)
        PhoneTestOrigin = $phoneUrl
        DeviceChecked = $false
        Instructions = 'Conecta tu teléfono por USB, habilita Opciones de desarrollador y Depuración USB y acepta su aviso. Inicia el servidor de pruebas manualmente. Después ejecuta este script con -Connect; -Disconnect retira sólo ese mapeo.'
        Note = 'No se ejecutó ADB ni se inició ningún servidor. Una respuesta HTTP200 de /api/health no demuestra que todas las funciones estén listas.'
    }
    return
}
if (-not $adb) { throw 'No se encontró Android SDK Platform-Tools. Indica un adb.exe existente con -AdbPath; este script no descarga herramientas.' }
if ($Connect -and $healthStatus -ne 200) { throw 'El servidor de pruebas no responde HTTP200 en /api/health. Inícialo manualmente en el puerto elegido antes de conectar.' }

# First possible ADB invocation: reachable only after the explicit opt-in above.
$deviceOutput = Invoke-ScopedAdb -Executable $adb -AdbArguments @('devices')
$selectedSerial = Select-AuthorizedDevice -DeviceOutput $deviceOutput -RequestedSerial $Serial
$socket = "tcp:$Port"
$mappings = @(Get-SelectedMappings -Executable $adb -SelectedSerial $selectedSerial)
$atPort = @($mappings | Where-Object { $_.DeviceSocket -ceq $socket })
if ($atPort.Count -gt 1 -or ($atPort.Count -eq 1 -and $atPort[0].PcSocket -cne $socket)) {
    throw 'Existe un mapeo diferente o ambiguo en el puerto elegido. No se modificó ni eliminó.'
}

if ($Connect) {
    if ($atPort.Count -eq 0) {
        [void](Invoke-ScopedAdb -Executable $adb -AdbArguments @('-s', $selectedSerial, 'reverse', '--no-rebind', $socket, $socket))
    }
    $verified = @(Get-SelectedMappings -Executable $adb -SelectedSerial $selectedSerial | Where-Object { $_.DeviceSocket -ceq $socket -and $_.PcSocket -ceq $socket })
    if ($verified.Count -ne 1) { throw 'No se pudo verificar el mapeo solicitado. No se declara conectado.' }
    [pscustomobject]@{
        Mode = 'EXACT_REVERSE_VERIFIED'
        Port = $Port
        PhoneTestOrigin = $phoneUrl
        DeviceChecked = $true
        IdentifierPrinted = $false
        Instructions = 'Abre Gunter · Pruebas en el teléfono e introduce el origen de prueba indicado. El HTTP local es sólo para el APK DEBUG; no uses este enlace para clientes.'
        Note = 'Sólo se verificó el túnel USB solicitado. No se instaló ningún APK ni se concedieron permisos.'
    }
} else {
    if ($atPort.Count -eq 1) {
        [void](Invoke-ScopedAdb -Executable $adb -AdbArguments @('-s', $selectedSerial, 'reverse', '--remove', $socket))
    }
    $remaining = @(Get-SelectedMappings -Executable $adb -SelectedSerial $selectedSerial | Where-Object { $_.DeviceSocket -ceq $socket })
    if ($remaining.Count -ne 0) { throw 'El mapeo aún existe; no se declara desconectado.' }
    [pscustomobject]@{
        Mode = 'EXACT_REVERSE_ABSENT'
        Port = $Port
        DeviceChecked = $true
        IdentifierPrinted = $false
        Note = 'Sólo se retiró o comprobó ausente el mapeo exacto elegido. No se detuvo el servidor PC ni el servidor ADB.'
    }
}
