#requires -Version 5.1
<#
.SYNOPSIS
    Cleanly terminate any running Discord Control Center backend before a fresh start.

.DESCRIPTION
    Targets ONLY this app's processes, never the whole machine:
      1) python / pythonw processes whose executable lives in this folder's bundled
         python\ runtime or whose command line references this folder's backend\main.py
         (catches the live backend AND any orphaned/zombie instance), and
      2) whatever process currently owns the dashboard port (belt-and-suspenders).

    Unrelated Python processes (MCP servers, other venvs, system Python) are left
    untouched. The SQLite store uses WAL, so a hard kill is safe.

.PARAMETER Root
    Absolute path to the app root (the folder containing the backend directory).

.PARAMETER Port
    Dashboard TCP port to free up. Default 8020.

.PARAMETER DryRun
    Report which processes WOULD be killed without terminating anything.
#>
param(
    [Parameter(Mandatory = $true)] [string] $Root,
    [int] $Port = 8020,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# This app's backend entrypoint + bundled-python prefix are the discriminators.
# Both are unique to this app, so unrelated python processes are never matched.
$mainPy = (Join-Path $Root 'backend\main.py')
$pyPrefix = (Join-Path $Root 'python')

function Get-AppProcessIds {
    $ids = [System.Collections.Generic.HashSet[int]]::new()

    # 1) Any python(w) instance of THIS app. Two complementary discriminators,
    #    because the backend may be launched with cwd=backend so its command line
    #    can be the RELATIVE "main.py" (not the full path):
    #      a) executable lives in this folder's bundled python\  -> catches it
    #         even when the command line is just "main.py"
    #      b) command line contains the full backend\main.py path
    try {
        $cmp = [System.StringComparison]::OrdinalIgnoreCase
        $procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            $cmd = [string]$p.CommandLine
            $exe = [string]$p.ExecutablePath
            $matchPy = $exe -and $exe.StartsWith($pyPrefix, $cmp)
            $matchPath = $cmd -and $cmd.IndexOf($mainPy, $cmp) -ge 0
            if ($matchPy -or $matchPath) {
                [void]$ids.Add([int]$p.ProcessId)
            }
        }
    } catch {
        Write-Host "  [!] Could not enumerate processes via CIM: $($_.Exception.Message)"
    }

    # 2) Whoever owns the dashboard port (in case a process holds the port
    #    without a recognizable command line).
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.OwningProcess) { [void]$ids.Add([int]$c.OwningProcess) }
        }
    } catch { }

    # Never target our own PowerShell process.
    [void]$ids.Remove($PID)
    return $ids
}

$targets = Get-AppProcessIds

if ($targets.Count -eq 0) {
    Write-Host "  No running Discord Control Center instance found. Clean to start."
    exit 0
}

foreach ($id in $targets) {
    $name = try { (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { '<gone>' }
    if ($DryRun) {
        Write-Host "  [dry-run] would kill PID $id ($name)"
        continue
    }
    try {
        Stop-Process -Id $id -Force -ErrorAction Stop
        Write-Host "  Killed PID $id ($name)"
    } catch {
        Write-Host "  [!] Failed to kill PID $id ($name): $($_.Exception.Message)"
    }
}

if ($DryRun) { exit 0 }

# Wait for the port to actually be released before the caller relaunches,
# otherwise the fresh backend fails to bind.
for ($i = 0; $i -lt 40; $i++) {
    $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $still) {
        Write-Host "  Port $Port is free."
        exit 0
    }
    Start-Sleep -Milliseconds 250
}

Write-Host "  [!] Port $Port still in use after wait; the new start may fail to bind."
exit 1
