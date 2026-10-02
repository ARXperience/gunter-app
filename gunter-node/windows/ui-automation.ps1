$ErrorActionPreference = 'Stop'

function Write-Result($Value) {
    $Value | ConvertTo-Json -Depth 8 -Compress
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'desktop_ui_request_required' }
    $request = $raw | ConvertFrom-Json

    if ($request.action -eq 'media') {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GunterMediaKeys {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
        $keys = @{ play_pause = 0xB3; stop = 0xB2; next = 0xB0; previous = 0xB1; mute = 0xAD; volume_down = 0xAE; volume_up = 0xAF }
        $key = $keys[[string]$request.mediaAction]
        if ($null -eq $key) { throw 'desktop_media_action_not_allowed' }
        [GunterMediaKeys]::keybd_event([byte]$key, 0, 0, [UIntPtr]::Zero)
        [GunterMediaKeys]::keybd_event([byte]$key, 0, 2, [UIntPtr]::Zero)
        Write-Result @{ ok = $true; result = @{ action = [string]$request.mediaAction }; evidence = @{ mediaCommandSent = $true; action = [string]$request.mediaAction } }
        exit 0
    }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName WindowsBase
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GunterForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out Point point);
}
'@

    if ($request.action -eq 'capture_target') {
        $delay = [Math]::Min([Math]::Max([int]$request.delayMs, 1000), 10000)
        Start-Sleep -Milliseconds $delay
        $point = New-Object 'GunterForegroundWindow+Point'
        if (-not [GunterForegroundWindow]::GetCursorPos([ref]$point)) { throw 'desktop_ui_cursor_unavailable' }
        $element = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new([double]$point.X, [double]$point.Y))
        if ($null -eq $element) { throw 'desktop_ui_control_not_found' }
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $actionable = $element
        for ($depth = 0; $depth -lt 8 -and $null -ne $actionable; $depth += 1) {
            $pattern = $null
            $supportsAction = $actionable.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) -or
                $actionable.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -or
                $actionable.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) -or
                $actionable.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)
            if ($supportsAction -or $depth -eq 7) { break }
            $parent = $walker.GetParent($actionable)
            if ($null -eq $parent) { break }
            $actionable = $parent
        }
        if ([bool]$actionable.Current.IsPassword) { throw 'desktop_ui_sensitive_field_not_allowed' }
        $window = $actionable
        for ($depth = 0; $depth -lt 16 -and $null -ne $window; $depth += 1) {
            if ($window.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
            $parent = $walker.GetParent($window)
            if ($null -eq $parent) { break }
            $window = $parent
        }
        $process = Get-Process -Id $actionable.Current.ProcessId -ErrorAction SilentlyContinue
        $actions = @()
        $pattern = $null
        if ($actionable.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) -or $actionable.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) -or $actionable.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $actions += 'click' }
        if ($actionable.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $actions += 'type' }
        if ($actionable.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) { $actions += 'scroll' }
        $actions += 'focus'
        $actions += 'wait'
        $typeName = [string]$actionable.Current.ControlType.ProgrammaticName
        if ($typeName.StartsWith('ControlType.')) { $typeName = $typeName.Substring(12) }
        Write-Result @{ ok = $true; result = @{ app = [string]$process.ProcessName; window = [string]$window.Current.Name; target = @{ name = [string]$actionable.Current.Name; automationId = [string]$actionable.Current.AutomationId; controlType = $typeName; supportedActions = $actions } }; evidence = @{ targetCaptured = $true } }
        exit 0
    }

    function Get-WindowElement($Request) {
        $needleApp = [string]$Request.app
        $needleTitle = [string]$Request.window
        if (-not [string]::IsNullOrWhiteSpace($needleApp) -or -not [string]::IsNullOrWhiteSpace($needleTitle)) {
            $processes = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }
            foreach ($process in $processes) {
                $appMatch = [string]::IsNullOrWhiteSpace($needleApp) -or $process.ProcessName.Equals($needleApp, [StringComparison]::OrdinalIgnoreCase) -or $process.MainWindowTitle.IndexOf($needleApp, [StringComparison]::OrdinalIgnoreCase) -ge 0
                $titleMatch = [string]::IsNullOrWhiteSpace($needleTitle) -or $process.MainWindowTitle.IndexOf($needleTitle, [StringComparison]::OrdinalIgnoreCase) -ge 0
                if ($appMatch -and $titleMatch) { return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle) }
            }
            throw 'desktop_ui_window_not_found'
        }
        $handle = [GunterForegroundWindow]::GetForegroundWindow()
        if ($handle -eq [IntPtr]::Zero) { throw 'desktop_ui_window_not_found' }
        return [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    }

    function Control-TypeName($Element) {
        $name = [string]$Element.Current.ControlType.ProgrammaticName
        if ($name.StartsWith('ControlType.')) { return $name.Substring(12) }
        return $name
    }

    function Find-Target($Window, $Target) {
        $all = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($element in $all) {
            $id = [string]$element.Current.AutomationId
            $name = [string]$element.Current.Name
            $type = Control-TypeName $element
            $idMatch = [string]::IsNullOrWhiteSpace([string]$Target.automationId) -or $id.Equals([string]$Target.automationId, [StringComparison]::OrdinalIgnoreCase)
            $nameMatch = [string]::IsNullOrWhiteSpace([string]$Target.name) -or $name.Equals([string]$Target.name, [StringComparison]::OrdinalIgnoreCase) -or $name.IndexOf([string]$Target.name, [StringComparison]::OrdinalIgnoreCase) -ge 0
            $typeMatch = [string]::IsNullOrWhiteSpace([string]$Target.controlType) -or $type.Equals([string]$Target.controlType, [StringComparison]::OrdinalIgnoreCase)
            if ($idMatch -and $nameMatch -and $typeMatch) { return $element }
        }
        throw 'desktop_ui_control_not_found'
    }

    if ($request.action -eq 'wait') {
        $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Min([Math]::Max([int]$request.timeoutMs, 1000), 30000))
        do {
            try {
                $waitWindow = Get-WindowElement $request
                $waitTarget = Find-Target $waitWindow $request.target
                if ($null -ne $waitTarget -and [bool]$waitTarget.Current.IsEnabled) {
                    Write-Result @{ ok = $true; result = @{ window = [string]$waitWindow.Current.Name; target = [string]$waitTarget.Current.Name; automationId = [string]$waitTarget.Current.AutomationId }; evidence = @{ targetObserved = $true } }
                    exit 0
                }
            } catch {
                if ($_.Exception.Message -notin @('desktop_ui_window_not_found', 'desktop_ui_control_not_found')) { throw }
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'desktop_ui_wait_timeout'
    }

    $window = Get-WindowElement $request
    $windowTitle = [string]$window.Current.Name

    if ($request.action -eq 'hotkey') {
        Add-Type -AssemblyName System.Windows.Forms
        $shortcuts = @{
            'ctrl+s' = '^s'; 'ctrl+c' = '^c'; 'ctrl+v' = '^v'; 'ctrl+a' = '^a'; 'ctrl+f' = '^f'; 'alt+f4' = '%{F4}'
            'enter' = '{ENTER}'; 'escape' = '{ESC}'; 'tab' = '{TAB}'; 'shift+tab' = '+{TAB}'; 'delete' = '{DELETE}'
            'backspace' = '{BACKSPACE}'; 'arrowup' = '{UP}'; 'arrowdown' = '{DOWN}'; 'arrowleft' = '{LEFT}'; 'arrowright' = '{RIGHT}'
        }
        $sequence = $shortcuts[[string]$request.shortcut]
        if ([string]::IsNullOrWhiteSpace($sequence)) { throw 'desktop_ui_shortcut_not_allowed' }
        $window.SetFocus()
        Start-Sleep -Milliseconds 120
        [System.Windows.Forms.SendKeys]::SendWait($sequence)
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; shortcut = [string]$request.shortcut }; evidence = @{ shortcutSent = $true } }
        exit 0
    }

    if ($request.action -eq 'select_file') {
        $filePath = [string]$request.filePath
        if ([string]::IsNullOrWhiteSpace($filePath)) { throw 'desktop_file_path_required' }
        $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $fileNameControl = $null
        foreach ($element in $all) {
            if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit -or [bool]$element.Current.IsPassword) { continue }
            $name = [string]$element.Current.Name
            $id = [string]$element.Current.AutomationId
            if ($id -eq '1148' -or $name -match '(?i)file\s*name|nombre\s+de\s+archivo|nombre') { $fileNameControl = $element; break }
        }
        if ($null -eq $fileNameControl) { throw 'desktop_file_picker_not_found' }
        $value = $null
        if (-not $fileNameControl.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { throw 'desktop_file_picker_not_editable' }
        ([System.Windows.Automation.ValuePattern]$value).SetValue($filePath)
        $openButton = $null
        foreach ($element in $all) {
            if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
            $name = [string]$element.Current.Name
            $id = [string]$element.Current.AutomationId
            if ($id -eq '1' -or $name -match '^(?i:open|abrir|choose|seleccionar)$') { $openButton = $element; break }
        }
        if ($null -eq $openButton) { throw 'desktop_file_picker_confirm_not_found' }
        $invoke = $null
        if (-not $openButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { throw 'desktop_ui_control_not_invokable' }
        ([System.Windows.Automation.InvokePattern]$invoke).Invoke()
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; fileName = [IO.Path]::GetFileName($filePath) }; evidence = @{ fileSelected = $true } }
        exit 0
    }

    if ($request.action -eq 'inspect') {
        $limit = [Math]::Min([Math]::Max([int]$request.limit, 1), 250)
        $controls = @()
        $hasTarget = -not [string]::IsNullOrWhiteSpace([string]$request.target.name) -or -not [string]::IsNullOrWhiteSpace([string]$request.target.automationId)
        $all = if ($hasTarget) { @((Find-Target $window $request.target)) } else { $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) }
        foreach ($element in $all) {
            if ($controls.Count -ge $limit) { break }
            $name = [string]$element.Current.Name
            $id = [string]$element.Current.AutomationId
            if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($id)) { continue }
            $controls += @{ name = $name; automationId = $id; controlType = (Control-TypeName $element); enabled = [bool]$element.Current.IsEnabled; focusable = [bool]$element.Current.IsKeyboardFocusable }
        }
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; controls = $controls }; evidence = @{ controlsInspected = $true; controlCount = $controls.Count } }
        exit 0
    }

    $target = if ([string]::IsNullOrWhiteSpace([string]$request.target.name) -and [string]::IsNullOrWhiteSpace([string]$request.target.automationId)) { $window } else { Find-Target $window $request.target }
    $targetName = [string]$target.Current.Name
    $targetId = [string]$target.Current.AutomationId

    if ($request.action -eq 'focus') {
        $target.SetFocus()
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; target = $targetName; automationId = $targetId }; evidence = @{ windowFocused = $true } }
        exit 0
    }

    if ($request.action -eq 'click') {
        $pattern = $null
        if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.InvokePattern]$pattern).Invoke() }
        elseif ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.SelectionItemPattern]$pattern).Select() }
        elseif ($target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.TogglePattern]$pattern).Toggle() }
        else { throw 'desktop_ui_control_not_invokable' }
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; target = $targetName; automationId = $targetId }; evidence = @{ controlInvoked = $true } }
        exit 0
    }

    if ($request.action -eq 'type') {
        $pattern = $null
        if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw 'desktop_ui_control_not_editable' }
        $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
        if ($valuePattern.Current.IsReadOnly) { throw 'desktop_ui_control_read_only' }
        $valuePattern.SetValue([string]$request.text)
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; target = $targetName; automationId = $targetId; characters = ([string]$request.text).Length }; evidence = @{ valueSet = $true } }
        exit 0
    }

    if ($request.action -eq 'scroll') {
        $scrollTarget = $target
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $scrollPattern = $null
        for ($depth = 0; $depth -lt 8 -and $null -ne $scrollTarget; $depth += 1) {
            if ($scrollTarget.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$scrollPattern)) { break }
            $scrollTarget = $walker.GetParent($scrollTarget)
        }
        if ($null -eq $scrollPattern) { throw 'desktop_ui_control_not_scrollable' }
        $scroll = [System.Windows.Automation.ScrollPattern]$scrollPattern
        $direction = [string]$request.direction
        $amount = [Math]::Min([Math]::Max([int]$request.amount, 1), 10)
        $before = if ($direction -in @('up', 'down')) { $scroll.Current.VerticalScrollPercent } else { $scroll.Current.HorizontalScrollPercent }
        for ($index = 0; $index -lt $amount; $index += 1) {
            $horizontal = [System.Windows.Automation.ScrollAmount]::NoAmount
            $vertical = [System.Windows.Automation.ScrollAmount]::NoAmount
            if ($direction -eq 'down') { $vertical = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
            elseif ($direction -eq 'up') { $vertical = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
            elseif ($direction -eq 'right') { $horizontal = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
            elseif ($direction -eq 'left') { $horizontal = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
            else { throw 'desktop_ui_scroll_direction_not_allowed' }
            $scroll.Scroll($horizontal, $vertical)
        }
        $after = if ($direction -in @('up', 'down')) { $scroll.Current.VerticalScrollPercent } else { $scroll.Current.HorizontalScrollPercent }
        if ($before -eq $after) { throw 'desktop_ui_scroll_not_changed' }
        Write-Result @{ ok = $true; result = @{ window = $windowTitle; direction = $direction; amount = $amount }; evidence = @{ scrollChanged = $true; before = $before; after = $after } }
        exit 0
    }

    throw 'desktop_ui_action_not_allowed'
} catch {
    $code = if ([string]::IsNullOrWhiteSpace($_.Exception.Message)) { 'desktop_ui_runtime_failed' } else { $_.Exception.Message }
    Write-Result @{ ok = $false; error = $code }
    exit 1
}
