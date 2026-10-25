param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$AndroidJar,
    [Parameter(Mandatory = $true)][string]$WebKitAar,
    [string]$CacheDirectory = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference = 'Stop'

# Fallback Kotlin type check ONLY. Uses exact shell sources plus explicitly
# generated stubs for three unrelated app symbols. Never packages an APK or
# substitutes this SDK for the compileSdk=35 Android/Gradle build.
function CachedJar([string]$relative) {
    $jarCandidates = @(Get-ChildItem -LiteralPath (Join-Path $CacheDirectory $relative) -Recurse -Filter '*.jar' -File)
    if ($jarCandidates.Count -ne 1) { throw "Expected exactly one cached dependency: $relative" }
    return $jarCandidates[0].FullName
}
$java = Join-Path (Resolve-Path -LiteralPath $JavaHome).Path 'bin/java.exe'
if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { throw 'Java executable is missing.' }
$android = (Resolve-Path -LiteralPath $AndroidJar).Path
if ((Split-Path $android -Leaf) -ne 'android.jar') { throw 'Pass the existing official SDK android.jar for type references.' }
$compiler = CachedJar 'org.jetbrains.kotlin/kotlin-compiler-embeddable/2.0.21'
$stdlib = CachedJar 'org.jetbrains.kotlin/kotlin-stdlib/1.9.23'
$reflect = CachedJar 'org.jetbrains.kotlin/kotlin-reflect/1.6.10'
$trove = CachedJar 'org.jetbrains.intellij.deps/trove4j/1.0.20200330'
$coroutines = CachedJar 'org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.6.4'
$annotations = CachedJar 'org.jetbrains/annotations/13.0'
$mobileRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $mobileRoot '..')).Path
$sourceRoot = Join-Path $mobileRoot 'android/app/src/main/java/com/gunter/mobile'
$output = Join-Path $repositoryRoot 'output/android-shell-typecheck'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$webKit = (Resolve-Path -LiteralPath $WebKitAar).Path
if ((Get-FileHash -LiteralPath $webKit -Algorithm SHA256).Hash.ToLowerInvariant() -ne '18a0a51ad129e0c8563f031d46c8a7e61169f56ae84e562a0d75686941262111') {
    throw 'Pass the verified official AndroidX WebKit 1.12.1 AAR; do not substitute a stub for its API.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($webKit)
$webKitClasses = Join-Path $output 'webkit-1.12.1-classes.jar'
try {
    $entry = $archive.GetEntry('classes.jar')
    if (-not $entry -or $entry.Length -gt 16MB) { throw 'WebKit classes.jar is missing or unexpectedly large.' }
    $input = $entry.Open()
    $destination = [IO.File]::Open($webKitClasses, [IO.FileMode]::Create)
    try { $input.CopyTo($destination) } finally { $input.Dispose(); $destination.Dispose() }
} finally { $archive.Dispose() }
$stubs = Join-Path $output 'ShellTypecheckStubs.kt'
$stubSource = @'
// GENERATED TYPECHECK INPUT ONLY. Never compile this file into an APK.
package com.gunter.mobile
object BuildConfig {
    const val DEBUG = true
    const val GUNTER_WEB_ORIGIN = ""
}
class MainActivity : android.app.Activity()
object ReminderReceiver {
    @Suppress("UNUSED_PARAMETER")
    fun reschedulePending(context: android.content.Context) {}
}
'@
[IO.File]::WriteAllText($stubs, $stubSource, [Text.UTF8Encoding]::new($false))
$sources = @('GunterWebActivity.kt', 'WebDownloadController.kt', 'WebOriginPolicy.kt', 'WebBlobExportController.kt', 'WebExportProtocol.kt', 'WebExportScript.kt') | ForEach-Object { Join-Path $sourceRoot $_ }
foreach ($source in $sources) { if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'An exact shell source is missing.' } }
$separator = [IO.Path]::PathSeparator
$compilerClasspath = @($compiler, $stdlib, $reflect, $trove, $coroutines, $annotations) -join $separator
$sourceClasspath = @($stdlib, $annotations, $android, $webKitClasses) -join $separator
$target = Join-Path $output 'gunter-shell-typecheck.jar'
& $java -Xmx1024m -cp $compilerClasspath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
    -no-stdlib -no-reflect -jvm-target 17 -language-version 2.0 -api-version 1.9 `
    -classpath $sourceClasspath -d $target @sources $stubs
if ($LASTEXITCODE -ne 0) { throw "Kotlin shell typecheck failed (exit $LASTEXITCODE). No APK was built." }
$report = [ordered]@{
    kind = 'KOTLIN_SHELL_TYPECHECK_WITH_EXPLICIT_STUBS'; passed = $true; generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    kotlinCompilerVersion = '2.0.21'; stdlibVersion = '1.9.23'; jvmTarget = '17'; languageVersion = '2.0'; apiVersion = '1.9'
    androidJar = [ordered]@{ path = $android; sha256 = (Get-FileHash -LiteralPath $android -Algorithm SHA256).Hash.ToLowerInvariant(); usage = 'Type references only; does not substitute compileSdk=35.' }
    webKit = [ordered]@{ version = '1.12.1'; aarPath = $webKit; aarSha256 = (Get-FileHash -LiteralPath $webKit -Algorithm SHA256).Hash.ToLowerInvariant(); classesSha256 = (Get-FileHash -LiteralPath $webKitClasses -Algorithm SHA256).Hash.ToLowerInvariant() }
    sources = @($sources | ForEach-Object { [ordered]@{ path = (Resolve-Path -LiteralPath $_).Path; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() } })
    stubs = [ordered]@{ path = $stubs; sha256 = (Get-FileHash -LiteralPath $stubs -Algorithm SHA256).Hash.ToLowerInvariant(); symbols = @('BuildConfig', 'MainActivity', 'ReminderReceiver.reschedulePending') }
    jarSha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    notVerified = @('Gradle build', 'APK packaging', 'API-35 compatibility', 'Manifest/resources', 'Android runtime behavior', 'Signing', 'Physical-device acceptance')
}
[IO.File]::WriteAllText((Join-Path $output 'report.json'), ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Output 'PASS: exact shell Kotlin sources typecheck with three generated stubs only. Not an APK, API-35 build, manifest/resource check, Android runtime test or device acceptance.'
