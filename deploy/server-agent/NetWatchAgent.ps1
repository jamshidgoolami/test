#Requires -Version 5.1
<#
.SYNOPSIS
    NetWatch Windows Server Agent
.DESCRIPTION
    Collects CPU, memory, volume/physical-disk health and NIC throughput and
    posts them to NetWatch. The agent makes outbound HTTPS requests only; it
    does not open a listening port on the monitored server.

    Run through the NetWatchAgent scheduled task installed by
    Install-NetWatchAgent.ps1. Do not put the token on the command line in
    production; it is read from agent.json, protected by an ACL.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'agent.json'),
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Write-AgentLog {
    param([string]$Message)
    try {
        $dir = Split-Path -Parent $ConfigPath
        $log = Join-Path $dir 'agent.log'
        if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
            Move-Item -LiteralPath $log -Destination "$log.1" -Force
        }
        $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    } catch { }
}

function To-Health([string]$Status) {
    switch -Regex ($Status) {
        '^(Healthy|OK|Normal|Up)$' { return 'ok' }
        '^(Warning|Degraded)$' { return 'warning' }
        '^(Unhealthy|Failed|Error|Down)$' { return 'critical' }
        default { return 'unknown' }
    }
}

function Get-SafeValue {
    param([scriptblock]$Script, $Default = $null)
    try { return & $Script } catch { return $Default }
}

function Get-CpuInfo {
    $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
    $usage = Get-SafeValue {
        $perf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop
        if ($null -ne $perf.PercentProcessorTime) { [double]$perf.PercentProcessorTime } else { $null }
    }
    if ($null -eq $usage) {
        $usage = Get-SafeValue {
            [double](Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue
        }
    }
    if ($null -ne $usage) { $usage = [math]::Round([math]::Min(100, [math]::Max(0, $usage)), 1) }
    return [ordered]@{
        usagePct = $usage
        model = ($processors | Select-Object -First 1).Name
        cores = ($processors | Measure-Object -Property NumberOfCores -Sum).Sum
        threads = ($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    }
}

function Get-MemoryInfo {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    return [ordered]@{
        totalBytes = [int64]$os.TotalVisibleMemorySize * 1024
        freeBytes = [int64]$os.FreePhysicalMemory * 1024
    }
}

function Get-VolumeInfo {
    $volumes = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue)
    return @($volumes | ForEach-Object {
        [ordered]@{
            key = 'volume:' + $_.DeviceID
            kind = 'volume'
            name = if ($_.VolumeName) { $_.VolumeName } else { $_.DeviceID }
            mount = $_.DeviceID
            filesystem = $_.FileSystem
            totalBytes = [int64]$_.Size
            freeBytes = [int64]$_.FreeSpace
            health = 'ok'
        }
    })
}

function Get-PhysicalDiskInfo {
    $disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue)
    return @($disks | ForEach-Object {
        $disk = $_
        $reliability = Get-SafeValue { Get-StorageReliabilityCounter -PhysicalDisk $disk -ErrorAction Stop }
        $temperature = $null
        $wear = $null
        $readErrors = $null
        $writeErrors = $null
        $powerOnHours = $null
        if ($null -ne $reliability) {
            if ($null -ne $reliability.Temperature -and [double]$reliability.Temperature -gt 0) { $temperature = [double]$reliability.Temperature }
            if ($null -ne $reliability.Wear) { $wear = [double]$reliability.Wear }
            if ($null -ne $reliability.ReadErrorsTotal) { $readErrors = [int64]$reliability.ReadErrorsTotal }
            if ($null -ne $reliability.WriteErrorsTotal) { $writeErrors = [int64]$reliability.WriteErrorsTotal }
            if ($null -ne $reliability.PowerOnHours) { $powerOnHours = [int64]$reliability.PowerOnHours }
        }
        [ordered]@{
            key = 'physical:' + $(if ($disk.SerialNumber) { $disk.SerialNumber } else { [string]$disk.DeviceId })
            kind = 'physical'
            name = $disk.FriendlyName
            mount = ''
            filesystem = ''
            totalBytes = [int64]$disk.Size
            freeBytes = $null
            health = To-Health ([string]$disk.HealthStatus)
            temperatureC = $temperature
            wearPct = $wear
            readErrors = $readErrors
            writeErrors = $writeErrors
            powerOnHours = $powerOnHours
        }
    })
}

function Convert-LinkSpeed([string]$Text) {
    if (-not $Text) { return $null }
    if ($Text -match '^\s*([\d.]+)\s*([KMGT])bps\s*$') {
        $value = [double]$Matches[1]
        switch ($Matches[2]) {
            'K' { $value *= 1000 }
            'M' { $value *= 1000000 }
            'G' { $value *= 1000000000 }
            'T' { $value *= 1000000000000 }
        }
        return [int64]$value
    }
    return $null
}

function Get-NetworkInfo {
    $adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
    if ($adapters.Count -eq 0) { return @() }

    $before = @{}
    foreach ($adapter in $adapters) {
        $stat = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue
        if ($null -ne $stat) {
            $before[$adapter.ifIndex] = @{
                rx = [int64]$stat.ReceivedBytes
                tx = [int64]$stat.SentBytes
                errorsRx = [int64]$stat.ReceivedPacketErrors
                errorsTx = [int64]$stat.OutboundPacketErrors
                at = [DateTime]::UtcNow
            }
        }
    }
    Start-Sleep -Milliseconds 1000
    $result = @()
    foreach ($adapter in $adapters) {
        $old = $before[$adapter.ifIndex]
        if ($null -eq $old) { continue }
        $stat = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue
        if ($null -eq $stat) { continue }
        $elapsed = ([DateTime]::UtcNow - $old.at).TotalSeconds
        if ($elapsed -le 0) { $elapsed = 1 }
        $rx = [math]::Max(0, ([int64]$stat.ReceivedBytes - $old.rx) * 8 / $elapsed)
        $tx = [math]::Max(0, ([int64]$stat.SentBytes - $old.tx) * 8 / $elapsed)
        $result += [ordered]@{
            name = $adapter.Name
            mac = $adapter.MacAddress
            speedBps = if ($null -ne $adapter.Speed) { [int64]$adapter.Speed } else { Convert-LinkSpeed ([string]$adapter.LinkSpeed) }
            rxBps = [math]::Round($rx)
            txBps = [math]::Round($tx)
            rxErrors = [int64]$stat.ReceivedPacketErrors
            txErrors = [int64]$stat.OutboundPacketErrors
            linkStatus = $adapter.Status.ToString().ToLowerInvariant()
        }
    }
    return $result
}

function Get-InventoryInfo {
    $system = Get-SafeValue { Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop }
    $bios = Get-SafeValue { Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop }
    $os = Get-SafeValue { Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop }
    $cpu = Get-SafeValue { Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop | Select-Object -First 1 }
    $mem = Get-SafeValue { Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop }
    return [ordered]@{
        manufacturer = if ($system) { $system.Manufacturer } else { '' }
        model = if ($system) { $system.Model } else { '' }
        serial = if ($bios) { $bios.SerialNumber } else { '' }
        biosVersion = if ($bios) { $bios.SMBIOSBIOSVersion } else { '' }
        cpuModel = if ($cpu) { $cpu.Name } else { '' }
        cpuCores = if ($cpu) { $cpu.NumberOfCores } else { $null }
        cpuThreads = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null }
        memoryTotalBytes = if ($mem) { [int64]$mem.TotalVisibleMemorySize * 1024 } else { $null }
        osName = if ($os) { $os.Caption } else { '' }
        osVersion = if ($os) { $os.Version } else { '' }
    }
}

function New-AgentPayload {
    $os = Get-SafeValue { Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop }
    $boot = if ($os -and $os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime() } else { $null }
    $uptime = if ($boot) { [int64]((Get-Date).ToUniversalTime() - $boot).TotalSeconds } else { $null }
    $payload = [ordered]@{
        schemaVersion = 1
        collectedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        os = [ordered]@{
            name = if ($os) { $os.Caption } else { '' }
            version = if ($os) { $os.Version } else { '' }
        }
        uptimeSec = $uptime
        cpu = Get-SafeValue { Get-CpuInfo } @{}
        memory = Get-SafeValue { Get-MemoryInfo } @{}
        inventory = Get-SafeValue { Get-InventoryInfo } @{}
        disks = @(Get-SafeValue { Get-VolumeInfo } @()) + @(Get-SafeValue { Get-PhysicalDiskInfo } @())
        nics = @(Get-SafeValue { Get-NetworkInfo } @())
    }
    return $payload
}

function Send-AgentPayload {
    param($Payload, [string]$ServerUrl, [string]$Token)
    $body = $Payload | ConvertTo-Json -Depth 8 -Compress
    $headers = @{ Authorization = "Bearer $Token" }
    $uri = $ServerUrl.TrimEnd('/') + '/api/agent/metrics'
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 25 | Out-Null
}

function Invoke-AgentCycle {
    param([string]$ServerUrl, [string]$Token)
    $payload = New-AgentPayload
    Send-AgentPayload -Payload $payload -ServerUrl $ServerUrl -Token $Token
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-AgentLog "Config not found: $ConfigPath"
    throw "Agent config not found: $ConfigPath"
}
try {
    $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
} catch {
    throw "Agent config is not valid JSON: $ConfigPath"
}
if (-not $cfg.serverUrl -or -not $cfg.token) { throw 'agent.json must contain serverUrl and token.' }
$serverUrl = [string]$cfg.serverUrl
$token = [string]$cfg.token
$interval = [int]$cfg.intervalSec
if ($interval -lt 15) { $interval = 30 }

if ($Once) {
    Invoke-AgentCycle -ServerUrl $serverUrl -Token $token
    Write-AgentLog 'One-shot collection sent.'
    exit 0
}

Write-AgentLog "Agent started. Endpoint: $serverUrl"
while ($true) {
    try {
        Invoke-AgentCycle -ServerUrl $serverUrl -Token $token
    } catch {
        Write-AgentLog ("Send failed: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds $interval
}
