param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$GradleDirectory,
    [string]$AndroidSdk,
    [ValidateSet(':app:tasks', ':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug')]
    [string[]]$Tasks = @(':app:tasks'),
    [switch]$Offline,
    [ValidateRange(15, 900)][int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'

# Per-invocation fallback for the observed Windows Java AF_UNIX IPC failure.
# Gradle 8.9 compares the immutable client/build JVM argument lists IN ORDER.
# Its defaults prepend java.util (environment support), then the unique Groovy
# and daemon JPMS flags. --no-daemon alone cannot guarantee an in-process build.
# References: https://docs.gradle.org/current/userguide/gradle_daemon.html
# No system settings, daemon registry, external server, key or device is changed.
$javaRoot = (Resolve-Path -LiteralPath $JavaHome).Path
$java = Join-Path $javaRoot 'bin/java.exe'
$gradleRoot = (Resolve-Path -LiteralPath $GradleDirectory).Path
$launcher = Join-Path $gradleRoot 'lib/gradle-gradle-cli-main-8.9.jar'
if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or -not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'Requires an existing JDK and the pinned official Gradle 8.9 distribution. Nothing is downloaded.'
}
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../android')).Path
$options = @(
    '--add-opens=java.base/java.util=ALL-UNNAMED',
    '--add-opens=java.base/java.lang=ALL-UNNAMED',
    '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
    '--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED',
    '--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
    '--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED',
    '--add-opens=java.base/java.nio.charset=ALL-UNNAMED',
    '--add-opens=java.base/java.net=ALL-UNNAMED',
    '--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED',
    '-Xmx2048m', '-Xms64m', '-Dfile.encoding=UTF-8',
    '-Dorg.gradle.internal.instrumentation.agent=false',
    '-classpath', $launcher, 'org.gradle.launcher.GradleMain',
    '-p', $project, '--no-daemon', '--console=plain',
    "-Dorg.gradle.java.home=$javaRoot", '-Dorg.gradle.vfs.watch=false',
    '-Dorg.gradle.jvmargs=-Xmx2048m -Xms64m -Dfile.encoding=UTF-8'
)
if ($Offline) { $options += '--offline' }
$options += $Tasks
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $java
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($option in $options) { $start.ArgumentList.Add($option) }
if ($AndroidSdk) { $start.Environment['ANDROID_HOME'] = (Resolve-Path -LiteralPath $AndroidSdk).Path }
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
try {
    if (-not $process.Start()) { throw 'Could not start the owned Gradle JVM.' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
        # Terminate only the exact Java process tree created above, never other
        # Gradle/Java daemons, Android Studio, browsers or device processes.
        $process.Kill($true)
        $process.WaitForExit()
    }
    $text = $stdout.GetAwaiter().GetResult()
    $errorText = $stderr.GetAwaiter().GetResult()
    if ($text) { Write-Output $text }
    if ($errorText) { Write-Output $errorText }
    if ($timedOut) { throw "Gradle timed out after $TimeoutSeconds seconds; stopped only its owned process tree." }
    if ($text.Contains('a single-use Daemon process will be forked')) {
        throw 'JVM reuse did not occur; do not treat this environment as validated in-process Gradle.'
    }
    if ($process.ExitCode -ne 0) { throw "Gradle failed (exit $($process.ExitCode)); no APK success is implied." }
} finally { $process.Dispose() }
