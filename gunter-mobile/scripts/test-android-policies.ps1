param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$AndroidJar,
    [string]$CacheDirectory = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference = 'Stop'

# Offline fallback for pure JVM policies only. This is NOT a Gradle build, APK,
# API-35 compatibility check, Android runtime test or physical-device acceptance.
# android.jar only resolves the unused Android storage adapter's type references.
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
# The cached 1.9.23 stdlib is sufficient for these API-1.9 pure policies and for
# running the 2.0.21 compiler. The APK keeps its declared Gradle dependencies.
$stdlib = CachedJar 'org.jetbrains.kotlin/kotlin-stdlib/1.9.23'
$reflect = CachedJar 'org.jetbrains.kotlin/kotlin-reflect/1.6.10'
$trove = CachedJar 'org.jetbrains.intellij.deps/trove4j/1.0.20200330'
$coroutines = CachedJar 'org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.6.4'
$annotations = CachedJar 'org.jetbrains/annotations/13.0'
$junit = CachedJar 'junit/junit/4.13.2'
$hamcrest = CachedJar 'org.hamcrest/hamcrest-core/1.3'

$mobileRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = Join-Path $mobileRoot 'android/app/src/main/java/com/gunter/mobile'
$testRoot = Join-Path $mobileRoot 'android/app/src/test/java/com/gunter/mobile'
$output = Join-Path $mobileRoot 'android/app/build/policy-jvm-tests'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$target = Join-Path $output 'gunter-policies-tests.jar'
$sources = @('WebOriginPolicy.kt', 'WebExportProtocol.kt', 'ReminderStore.kt', 'MobilePolicies.kt') | ForEach-Object { Join-Path $sourceRoot $_ }
$tests = @('WebOriginPolicyTest', 'WebExportProtocolTest', 'ReminderCoordinatorTest', 'MobileSmsPolicyTest', 'MobileMediaObservationTest')
$sources += $tests | ForEach-Object { Join-Path $testRoot "$_.kt" }
foreach ($source in $sources) { if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'A policy source/test is missing; do not replace it with a stub.' } }
$separator = [IO.Path]::PathSeparator
$compilerClasspath = @($compiler, $stdlib, $reflect, $trove, $coroutines, $annotations) -join $separator
$testClasspath = @($stdlib, $junit, $hamcrest, $annotations, $android) -join $separator

& $java -Xmx1024m -cp $compilerClasspath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
    -no-stdlib -no-reflect -jvm-target 17 -language-version 2.0 -api-version 1.9 `
    -classpath $testClasspath -d $target @sources
if ($LASTEXITCODE -ne 0) { throw "Kotlin policy compilation failed (exit $LASTEXITCODE). No APK was built." }

$runtimeClasspath = @($target, $stdlib, $junit, $hamcrest, $android) -join $separator
$testClasses = $tests | ForEach-Object { "com.gunter.mobile.$_" }
$testOutput = & $java -cp $runtimeClasspath org.junit.runner.JUnitCore @testClasses 2>&1
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output $_ }
$count = [regex]::Match(($testOutput -join "`n"), 'OK \((\d+) tests?\)')
if ($testExit -ne 0 -or -not $count.Success) { throw "JVM policy tests failed or returned an unexpected summary (exit $testExit)." }
$report = [ordered]@{
    kind = 'PURE_JVM_POLICY_TESTS'; passed = $true; generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    kotlinCompilerVersion = '2.0.21'; stdlibVersion = '1.9.23'; jvmTarget = '17'; languageVersion = '2.0'; apiVersion = '1.9'
    testsPassed = [int]$count.Groups[1].Value
    androidJar = [ordered]@{ path = $android; sha256 = (Get-FileHash -LiteralPath $android -Algorithm SHA256).Hash.ToLowerInvariant(); usage = 'Unused Android adapter type references only; not an Android runtime.' }
    sources = @($sources | ForEach-Object { [ordered]@{ path = (Resolve-Path -LiteralPath $_).Path; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() } })
    jarSha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    notVerified = @('Gradle build', 'APK packaging', 'API-35 compatibility', 'Android runtime behavior', 'Signing', 'Physical-device acceptance')
}
[IO.File]::WriteAllText((Join-Path $output 'report.json'), ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Output 'PASS: offline JVM policies only. APK packaging, API-35 build, signature, Android behavior and device QA remain unverified.'
