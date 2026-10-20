#requires -Version 7.0
<#
Read-only shader manifest: {"programs":[{"name":"...","vertex":"GLSL source","fragment":"GLSL source"}]}.
Run ONLY in a disposable child pwsh process, with an external watchdog owned by
the caller. This wrapper does not implement a timeout that could leave a native
compiler running. It never launches Chrome or writes result/source files. Default
mode never draws; -ProbeDraw allows just one bounded CPU-only 1x1 pipeline probe.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [string]$LibraryDirectory = (Join-Path ([Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')) 'AppData\Local\ms-playwright\chromium-1217\chrome-win64'),
    [switch]$ProbeDraw
)

$ErrorActionPreference = 'Stop'
$envNames = @('VK_ICD_FILENAMES', 'VK_DRIVER_FILES', 'VK_ADD_DRIVER_FILES', 'ANGLE_GL_RENDERER', 'ANGLE_GL_VENDOR', 'ANGLE_GL_VERSION')
$savedEnvironment = @{}
foreach ($name in $envNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$exitCode = 1
try {
    if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Requires Windows and a 64-bit PowerShell process.' }
    $manifestFile = Get-Item -LiteralPath $ManifestPath
    if ($manifestFile.PSIsContainer -or $manifestFile.Length -gt 16MB) { throw 'Manifest must be a JSON file no larger than 16 MiB.' }
    $manifest = [IO.File]::ReadAllText($manifestFile.FullName) | ConvertFrom-Json -AsHashtable -Depth 16
    if ($manifest -isnot [Collections.IDictionary] -or -not $manifest.Contains('programs') -or $manifest.programs -isnot [Array]) {
        throw 'Expected a JSON object containing a programs array.'
    }
    $programs = @($manifest.programs)
    if ($programs.Count -lt 1 -or $programs.Count -gt 64) { throw 'Expected 1–64 shader programs.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $names = [Collections.Generic.List[string]]::new()
    $vertices = [Collections.Generic.List[string]]::new()
    $fragments = [Collections.Generic.List[string]]::new()
    foreach ($program in $programs) {
        if ($program -isnot [Collections.IDictionary]) { throw 'Every program must be an object.' }
        foreach ($key in @('name', 'vertex', 'fragment')) {
            if ($program[$key] -isnot [string] -or [string]::IsNullOrWhiteSpace($program[$key])) { throw "Program $key must be a nonempty string." }
        }
        if ($program.name.Length -gt 160 -or -not $seen.Add($program.name)) { throw 'Program names must be unique and at most 160 characters.' }
        if ($program.vertex.Length -gt 4MB -or $program.fragment.Length -gt 4MB) { throw 'Each shader source must be no larger than 4 MiB.' }
        $names.Add($program.name); $vertices.Add($program.vertex); $fragments.Add($program.fragment)
    }
    if (-not [IO.Path]::IsPathFullyQualified($LibraryDirectory) -or $LibraryDirectory.StartsWith('\\')) { throw 'LibraryDirectory must be an absolute local directory, not a network path.' }
    $library = Get-Item -LiteralPath $LibraryDirectory
    if (-not $library.PSIsContainer) { throw 'LibraryDirectory must be a directory.' }
    $icd = Join-Path $library.FullName 'vk_swiftshader_icd.json'
    foreach ($artifact in @('libEGL.dll', 'libGLESv2.dll', 'vulkan-1.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $library.FullName $artifact) -PathType Leaf)) { throw "Missing required artifact: $artifact" }
    }
    $icdDocument = [IO.File]::ReadAllText($icd) | ConvertFrom-Json -AsHashtable -Depth 8
    if ($icdDocument.ICD.library_path -notin @('.\vk_swiftshader.dll', './vk_swiftshader.dll', 'vk_swiftshader.dll')) {
        throw 'ICD must point only to the sibling vk_swiftshader.dll.'
    }
    # Environment changes affect this disposable process only and are restored
    # even after a managed error. No user/machine settings or browser are touched.
    [Environment]::SetEnvironmentVariable('VK_ICD_FILENAMES', $icd, 'Process')
    [Environment]::SetEnvironmentVariable('VK_DRIVER_FILES', $icd, 'Process')
    foreach ($name in @('VK_ADD_DRIVER_FILES', 'ANGLE_GL_RENDERER', 'ANGLE_GL_VENDOR', 'ANGLE_GL_VERSION')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    if (-not ('GunterShaderValidation.AnatomyShaderCompiler' -as [type])) {
        $compilerSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AnatomyShaderCompiler.cs'))
        $null = Add-Type -TypeDefinition $compilerSource -Language CSharp
    }
    $results = [GunterShaderValidation.AnatomyShaderCompiler]::Compile($library.FullName, $names.ToArray(), $vertices.ToArray(), $fragments.ToArray(), $ProbeDraw.IsPresent)
    $rows = @($results | ForEach-Object {
        [ordered]@{ name = $_.Name; status = $_.Status; elapsedMilliseconds = $_.ElapsedMilliseconds;
            log = $_.Log; vertexLog = $_.VertexLog; fragmentLog = $_.FragmentLog; linkLog = $_.LinkLog;
            renderer = $_.Renderer; glVersion = $_.GlVersion; eglVersion = $_.EglVersion; webGlCompatibility = $_.WebGlCompatibility;
            pipelineProbe = $_.PipelineProbe; probeDraw = $_.ProbeDraw; probeStatus = $_.ProbeStatus;
            probePrimitive = $_.ProbePrimitive; probeVertices = $_.ProbeVertices; probeInstances = $_.ProbeInstances;
            probeSamplers = $_.ProbeSamplers; probePixelRgba8 = @($_.ProbePixelRgba8) }
    })
    $passed = @($results | Where-Object Status -ne 'PASS').Count -eq 0 -and $results.Count -eq $programs.Count
    [ordered]@{ status = $(if ($passed) { 'PASS' } else { 'FAIL' }); libraryDirectory = $library.FullName;
        icd = $icd; noDraw = -not $ProbeDraw.IsPresent; pipelineProbe = $ProbeDraw.IsPresent; programs = $rows } | ConvertTo-Json -Depth 8 -Compress
    if ($passed) { $exitCode = 0 }
}
catch {
    [ordered]@{ status = 'ERROR'; noDraw = -not $ProbeDraw.IsPresent; pipelineProbe = $ProbeDraw.IsPresent; log = $_.Exception.Message; programs = @() } | ConvertTo-Json -Depth 8 -Compress
}
finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
exit $exitCode
