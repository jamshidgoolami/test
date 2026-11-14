#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the NetWatch Windows Server Agent as a SYSTEM scheduled task.
.DESCRIPTION
    Copies NetWatchAgent.ps1 to Program Files, writes a protected agent.json,
    optionally trusts a private CA certificate, and registers an AtStartup
    scheduled task. The task runs as SYSTEM with automatic restart.

    This is deliberately a scheduled task, not a fake Windows service:
    PowerShell scripts cannot speak the SCM service protocol. The task gives
    the same always-on behavior without adding a third-party service wrapper.
.PARAMETER ServerUrl
    Base URL of NetWatch, for example https://netwatch.example.local:8080
.PARAMETER Token
    Per-server agent token shown once in NetWatch.
.PARAMETER IntervalSec
    Collection interval. Minimum 15; default 30.
.PARAMETER CaCertPath
    Optional path to a PEM/CER CA certificate. It is imported into
    LocalMachine\Root so the agent trusts the NetWatch HTTPS certificate.
.PARAMETER Uninstall
    Stops and removes the task and installation directory.
#>
[CmdletBinding()]
param(
    [string]$ServerUrl = '',
    [string]$Token = '',
    [int]$IntervalSec = 30,
    [string]$CaCertPath = '',
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'NetWatchAgent'),
    [string]$TaskName = 'NetWatchAgent',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
    try {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    } catch { }
    if (Test-Path -LiteralPath $InstallDir) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
    }
    Write-Host 'NetWatch Agent removed.' -ForegroundColor Green
    exit 0
}

if (-not $ServerUrl) { throw '-ServerUrl is required.' }
if (-not $Token) { throw '-Token is required (create the server in NetWatch and copy its token once).' }
if ($Token.Length -lt 40 -or -not $Token.StartsWith('nw_')) { throw 'The token format is invalid.' }
$uri = $null
if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$uri) -or ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http')) {
    throw '-ServerUrl must be an absolute http(s) URL.'
}
if ($uri.Scheme -eq 'http') {
    Write-Warning 'HTTP sends the agent token unencrypted. Use HTTPS on untrusted networks.'
}
if ($IntervalSec -lt 15) { $IntervalSec = 30 }

$source = Join-Path $PSScriptRoot 'NetWatchAgent.ps1'
if (-not (Test-Path -LiteralPath $source)) { throw "NetWatchAgent.ps1 was not found next to this installer: $source" }

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$agentPath = Join-Path $InstallDir 'NetWatchAgent.ps1'
Copy-Item -LiteralPath $source -Destination $agentPath -Force

if ($CaCertPath) {
    if (-not (Test-Path -LiteralPath $CaCertPath)) { throw "CA certificate not found: $CaCertPath" }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList ((Resolve-Path -LiteralPath $CaCertPath).Path)
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    $store.Open('ReadWrite')
    try { $store.Add($cert) } finally { $store.Close() }
    Write-Host "CA certificate imported into LocalMachine\Root: $($cert.Thumbprint)" -ForegroundColor Yellow
}

$configPath = Join-Path $InstallDir 'agent.json'
$config = [ordered]@{
    serverUrl = $ServerUrl.TrimEnd('/')
    token = $Token
    intervalSec = $IntervalSec
} | ConvertTo-Json
Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8

# فقط SYSTEM و Administrators به فایل حاوی توکن دسترسی داشته باشند. از SID
# استفاده می‌کنیم تا روی ویندوز با نام گروه‌های محلی‌شده هم کار کند.
& icacls.exe $configPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
& icacls.exe $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$agentPath`" -ConfigPath `"$configPath`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'NetWatch Agent installed successfully.' -ForegroundColor Green
Write-Host "  Install directory : $InstallDir"
Write-Host "  Task              : $TaskName (SYSTEM, AtStartup)"
Write-Host "  NetWatch          : $($ServerUrl.TrimEnd('/'))"
Write-Host "  Interval          : $IntervalSec seconds"
Write-Host ''
Write-Host 'Check status:  Get-ScheduledTask -TaskName NetWatchAgent | Get-ScheduledTaskInfo'
Write-Host "Agent log:      $InstallDir\agent.log"
Write-Host 'Allow outbound HTTPS from this server to NetWatch; no inbound port is required on the server.'
