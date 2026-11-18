# Sekai desktop helper for Windows: lets bots you allowed see and use this computer.
# Started by the Sekai desktop app; reads one JSON request per line on stdin and answers one JSON line on stdout.
# Input goes through SendInput, the screen through GDI, controls through UI Automation. All coordinates are
# physical pixels (this process is DPI-aware).

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SekaiInput {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;

    public static void DpiAware() {
        try { if (SetProcessDpiAwareness(2) == 0) return; } catch (Exception) { }
        SetProcessDPIAware();
    }

    public static int ScreenWidth() { return GetSystemMetrics(0); }
    public static int ScreenHeight() { return GetSystemMetrics(1); }

    public static int[] Pointer() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }

    static void Send(INPUT[] inputs) {
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length) {
            throw new InvalidOperationException("Windows blocked the input (error " + Marshal.GetLastWin32Error() + "). Apps running as administrator, and the lock or UAC screens, can't be controlled.");
        }
    }

    static INPUT Mouse(uint flags, uint data) {
        INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
    }

    static INPUT Key(ushort vk, ushort scan, uint flags) {
        INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
    }

    public static void MoveTo(int x, int y) { SetCursorPos(x, y); }

    public static void Click(int x, int y, string button, int count) {
        SetCursorPos(x, y);
        Thread.Sleep(40);
        uint down = 0x2, up = 0x4;
        if (button == "right") { down = 0x8; up = 0x10; }
        else if (button == "middle") { down = 0x20; up = 0x40; }
        for (int n = 0; n < count; n++) {
            Send(new INPUT[] { Mouse(down, 0), Mouse(up, 0) });
            if (n + 1 < count) Thread.Sleep(70);
        }
    }

    public static void Drag(int x1, int y1, int x2, int y2) {
        SetCursorPos(x1, y1);
        Thread.Sleep(60);
        Send(new INPUT[] { Mouse(0x2, 0) });
        for (int s = 1; s <= 12; s++) {
            SetCursorPos(x1 + (x2 - x1) * s / 12, y1 + (y2 - y1) * s / 12);
            Thread.Sleep(20);
        }
        Thread.Sleep(60);
        Send(new INPUT[] { Mouse(0x4, 0) });
    }

    public static void Scroll(int x, int y, int notches, bool horizontal) {
        SetCursorPos(x, y);
        Thread.Sleep(40);
        Send(new INPUT[] { Mouse(horizontal ? 0x1000u : 0x0800u, unchecked((uint)(notches * 120))) });
    }

    static bool Extended(ushort vk) {
        switch (vk) {
            case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27: case 0x28:
            case 0x2C: case 0x2D: case 0x2E: case 0x5B: case 0x5C: case 0x5D: case 0x6F: case 0x90:
                return true;
            default:
                return false;
        }
    }

    // Holds the keys down in order, then lets go in reverse: modifiers first, the key last.
    public static void Press(ushort[] vks) {
        List<INPUT> list = new List<INPUT>();
        foreach (ushort vk in vks) list.Add(Key(vk, (ushort)MapVirtualKey(vk, 0), Extended(vk) ? KEYEVENTF_EXTENDEDKEY : 0));
        for (int k = vks.Length - 1; k >= 0; k--) {
            list.Add(Key(vks[k], (ushort)MapVirtualKey(vks[k], 0), KEYEVENTF_KEYUP | (Extended(vks[k]) ? KEYEVENTF_EXTENDEDKEY : 0)));
        }
        Send(list.ToArray());
    }

    // Any text, as Unicode characters (independent of the keyboard layout); line breaks and tabs as real keys.
    public static void Type(string text) {
        foreach (char c in text) {
            if (c == '\r') continue;
            if (c == '\n') Press(new ushort[] { 0x0D });
            else if (c == '\t') Press(new ushort[] { 0x09 });
            else Send(new INPUT[] { Key(0, c, KEYEVENTF_UNICODE), Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) });
            Thread.Sleep(5);
        }
    }

    // The key that makes a character on the current layout, for shortcuts like ctrl+c.
    public static ushort VkOf(string s) {
        short r = VkKeyScan(s[0]);
        if (r == -1) throw new ArgumentException("There's no key for '" + s + "' on this keyboard layout");
        return (ushort)(r & 0xFF);
    }

    public static string ForegroundTitle() {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), sb, 512);
        return sb.ToString();
    }

    public static long Foreground() { return GetForegroundWindow().ToInt64(); }

    // Windows lets only the foreground app hand focus over. A tap of Alt counts as input and lifts that lock.
    public static bool Activate(long handle) {
        IntPtr h = new IntPtr(handle);
        if (IsIconic(h)) ShowWindow(h, 9);
        if (SetForegroundWindow(h) && GetForegroundWindow() == h) return true;
        Send(new INPUT[] { Key(0x12, 0, 0), Key(0x12, 0, KEYEVENTF_KEYUP) });
        return SetForegroundWindow(h);
    }
}
'@

[SekaiInput]::DpiAware()
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing

$AE = [System.Windows.Automation.AutomationElement]
$TreeScope = [System.Windows.Automation.TreeScope]
$script:elements = @{}

$Interactive = @('Button', 'CheckBox', 'ComboBox', 'Edit', 'Hyperlink', 'ListItem', 'MenuItem', 'RadioButton',
    'Slider', 'Spinner', 'SplitButton', 'TabItem', 'TreeItem', 'DataItem', 'Document', 'HeaderItem', 'MenuBar', 'ScrollBar')
$Containers = @('Pane', 'Group', 'Custom', 'Window', 'List', 'Tree', 'Table', 'Tab', 'ToolBar', 'StatusBar', 'TitleBar', 'Menu', 'Separator', 'Thumb')

function Box($r) {
    if ($r.IsEmpty -or [double]::IsInfinity($r.X) -or $r.Width -le 0 -or $r.Height -le 0) { return $null }
    return @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
}

function RoleOf($el) { return $el.Cached.ControlType.ProgrammaticName -replace '^ControlType\.', '' }

function ProcessName([int]$id) {
    try { return [System.Diagnostics.Process]::GetProcessById($id).ProcessName } catch { return '' }
}

function TopWindows {
    $list = New-Object System.Collections.ArrayList
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    foreach ($w in $AE::RootElement.FindAll($TreeScope::Children, $cond)) {
        try {
            $c = $w.Current
            if ($c.NativeWindowHandle -eq 0 -or $c.IsOffscreen -or [string]::IsNullOrWhiteSpace($c.Name)) { continue }
            $b = Box $c.BoundingRectangle
            if ($null -eq $b) { continue }
            [void]$list.Add(@{ id = [string]$c.NativeWindowHandle; app = (ProcessName $c.ProcessId); title = $c.Name;
                x = $b[0]; y = $b[1]; width = $b[2]; height = $b[3]; element = $w })
        } catch { }
    }
    return , $list
}

function Strip($windows) {
    $out = New-Object System.Collections.ArrayList
    foreach ($w in $windows) { [void]$out.Add(@{ id = $w.id; app = $w.app; title = $w.title; x = $w.x; y = $w.y; width = $w.width; height = $w.height }) }
    return , $out
}

function Cmd-Info {
    $wins = TopWindows
    $p = [SekaiInput]::Pointer()
    return @{ width = [SekaiInput]::ScreenWidth(); height = [SekaiInput]::ScreenHeight(); pointer = @($p[0], $p[1]);
        activeWindow = [SekaiInput]::ForegroundTitle(); windows = (Strip $wins) }
}

function Cmd-Screenshot($a) {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $full = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $g.Dispose()
    $max = [int]$a.maxWidth
    $img = $full
    if ($max -gt 0 -and $bounds.Width -gt $max) {
        $h = [int][Math]::Round($bounds.Height * $max / $bounds.Width)
        $img = New-Object System.Drawing.Bitmap $max, $h
        $g2 = [System.Drawing.Graphics]::FromImage($img)
        $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g2.DrawImage($full, 0, 0, $max, $h)
        $g2.Dispose()
        $full.Dispose()
    }
    $ms = New-Object System.IO.MemoryStream
    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    return @{ b64 = [Convert]::ToBase64String($ms.ToArray()) }
}

function Cmd-Tree($a) {
    $script:elements = @{}
    $wins = TopWindows
    $fg = [SekaiInput]::Foreground()
    $roots = New-Object System.Collections.ArrayList
    if ($a.app) {
        $needle = [string]$a.app
        foreach ($w in $wins) { if ($w.app -like "*$needle*" -or $w.title -like "*$needle*") { [void]$roots.Add($w.element) } }
        if ($roots.Count -eq 0) { throw "No open window matches '$needle'. Open windows: $(($wins | ForEach-Object { $_.app }) -join ', ')" }
    } else {
        foreach ($w in $wins) { if ([long]$w.id -eq $fg) { [void]$roots.Add($w.element) } }
        # The taskbar starts and switches apps.
        $tray = $AE::RootElement.FindFirst($TreeScope::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Shell_TrayWnd')))
        if ($tray) { [void]$roots.Add($tray) }
    }
    $cr = New-Object System.Windows.Automation.CacheRequest
    foreach ($p in @($AE::NameProperty, $AE::ControlTypeProperty, $AE::BoundingRectangleProperty, $AE::IsEnabledProperty,
            $AE::HasKeyboardFocusProperty, $AE::IsOffscreenProperty, $AE::IsPasswordProperty, $AE::IsInvokePatternAvailableProperty,
            $AE::IsTogglePatternAvailableProperty, $AE::IsExpandCollapsePatternAvailableProperty,
            $AE::IsSelectionItemPatternAvailableProperty, $AE::IsValuePatternAvailableProperty)) { $cr.Add($p) }
    $cr.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
    $out = New-Object System.Collections.ArrayList
    $n = 0
    $limit = 600
    $scope = $cr.Activate()
    try {
        foreach ($root in $roots) {
            if ($out.Count -ge $limit) { break }
            $found = $root.FindAll($TreeScope::Subtree, [System.Windows.Automation.Automation]::ControlViewCondition)
            foreach ($el in $found) {
                if ($out.Count -ge $limit) { break }
                try {
                    $c = $el.Cached
                    if ($c.IsOffscreen) { continue }
                    $box = Box $c.BoundingRectangle
                    if ($null -eq $box) { continue }
                    $role = RoleOf $el
                    $name = [string]$c.Name
                    $keep = $a.all -or ($Interactive -contains $role) -or ($name -and -not ($Containers -contains $role))
                    if (-not $keep) { continue }
                    $actions = New-Object System.Collections.ArrayList
                    if ($el.GetCachedPropertyValue($AE::IsInvokePatternAvailableProperty)) { [void]$actions.Add('invoke') }
                    if ($el.GetCachedPropertyValue($AE::IsTogglePatternAvailableProperty)) { [void]$actions.Add('toggle') }
                    if ($el.GetCachedPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { [void]$actions.Add('expand'); [void]$actions.Add('collapse') }
                    if ($el.GetCachedPropertyValue($AE::IsSelectionItemPatternAvailableProperty)) { [void]$actions.Add('select') }
                    $states = New-Object System.Collections.ArrayList
                    if ($c.HasKeyboardFocus) { [void]$states.Add('focused') }
                    if (-not $c.IsEnabled) { [void]$states.Add('disabled') }
                    $value = $null
                    if (($role -eq 'Edit' -or $role -eq 'ComboBox') -and $el.GetCachedPropertyValue($AE::IsValuePatternAvailableProperty)) {
                        if ($c.IsPassword) { $value = ([string][char]0x2022) * 3 }
                        else {
                            try { $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value; if ($v.Length -gt 300) { $v = $v.Substring(0, 300) }; $value = $v } catch { }
                        }
                    }
                    $n++
                    $id = "u$n"
                    $script:elements[$id] = $el
                    [void]$out.Add(@{ id = $id; role = $role.ToLower(); name = $name; box = $box; states = $states; value = $value; actions = $actions })
                } catch { }
            }
        }
    } finally {
        $scope.Dispose()
    }
    $apps = New-Object System.Collections.ArrayList
    foreach ($w in $wins) { if (-not ($apps -contains $w.app)) { [void]$apps.Add($w.app) } }
    return @{ activeWindow = [SekaiInput]::ForegroundTitle(); apps = $apps; elements = $out; truncated = ($out.Count -ge $limit) }
}

function Element($id) {
    $el = $script:elements[[string]$id]
    if ($null -eq $el) { throw "Element $id isn't in the latest tree; read the screen's controls again." }
    return $el
}

function Cmd-Act($a) {
    $el = Element $a.id
    $action = if ($a.action) { ([string]$a.action).ToLower() } else { '' }
    if ($action -eq 'click' -or $action -eq 'press') { $action = 'invoke' }
    $P = [System.Windows.Automation.InvokePattern]
    $available = @()
    if ($el.GetCurrentPropertyValue($AE::IsInvokePatternAvailableProperty)) { $available += 'invoke' }
    if ($el.GetCurrentPropertyValue($AE::IsTogglePatternAvailableProperty)) { $available += 'toggle' }
    if ($el.GetCurrentPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { $available += 'expand'; $available += 'collapse' }
    if ($el.GetCurrentPropertyValue($AE::IsSelectionItemPatternAvailableProperty)) { $available += 'select' }
    if ($available.Count -eq 0) { throw 'That element has no actions; click its box instead.' }
    if (-not $action) { $action = $available[0] }
    if (-not ($available -contains $action)) { throw "Actions available: $($available -join ', ')" }
    switch ($action) {
        'invoke' { $el.GetCurrentPattern($P::Pattern).Invoke() }
        'toggle' { $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
        'expand' { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
        'collapse' { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse() }
        'select' { $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
    }
    return @{ did = $action }
}

function Cmd-Focus($a) { (Element $a.id).SetFocus(); return @{ ok = $true } }

function Cmd-Key($a) {
    foreach ($combo in $a.combos) {
        $vks = New-Object System.Collections.Generic.List[uint16]
        foreach ($vk in $combo.vks) { $vks.Add([uint16]$vk) }
        if ($combo.char) { $vks.Add([SekaiInput]::VkOf([string]$combo.char)) }
        [SekaiInput]::Press($vks.ToArray())
        Start-Sleep -Milliseconds 60
    }
    return @{ ok = $true }
}

function Cmd-Activate($a) {
    if (-not [SekaiInput]::Activate([long]$a.id)) { throw "Windows didn't bring that window to the front." }
    return @{ ok = $true }
}

function Cmd-Open($a) {
    $command = [string]$a.command
    # "start" finds apps by name (notepad, msedge, winword), documents and URLs, like the Run box.
    Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c start `"`" $command" -WindowStyle Hidden
    Start-Sleep -Milliseconds 1500
    return @{ activeWindow = [SekaiInput]::ForegroundTitle() }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $res = @{ id = $null; ok = $false }
    try {
        $req = $line | ConvertFrom-Json
        $res.id = $req.id
        $a = $req.args
        $data = switch ([string]$req.cmd) {
            'info' { Cmd-Info }
            'screenshot' { Cmd-Screenshot $a }
            'tree' { Cmd-Tree $a }
            'act' { Cmd-Act $a }
            'focus' { Cmd-Focus $a }
            'click' { [SekaiInput]::Click([int]$a.x, [int]$a.y, [string]$a.button, [int]$a.count); @{ ok = $true } }
            'move' { [SekaiInput]::MoveTo([int]$a.x, [int]$a.y); @{ ok = $true } }
            'drag' { [SekaiInput]::Drag([int]$a.x1, [int]$a.y1, [int]$a.x2, [int]$a.y2); @{ ok = $true } }
            'scroll' { [SekaiInput]::Scroll([int]$a.x, [int]$a.y, [int]$a.notches, [bool]$a.horizontal); @{ ok = $true } }
            'type' { [SekaiInput]::Type([string]$a.text); @{ ok = $true } }
            'key' { Cmd-Key $a }
            'windows' { @{ activeWindow = [SekaiInput]::ForegroundTitle(); windows = (Strip (TopWindows)) } }
            'activate' { Cmd-Activate $a }
            'open' { Cmd-Open $a }
            default { throw "Unknown command $($req.cmd)" }
        }
        $res.data = $data
        $res.ok = $true
    } catch {
        $res.error = $_.Exception.Message
    }
    [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
}
