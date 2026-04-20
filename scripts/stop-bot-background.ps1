$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot ".runtime"
$supervisorPidFile = Join-Path $runtimeDir "bot-supervisor.pid"
$pidFile = Join-Path $runtimeDir "bot.pid"
$runMetadataFile = Join-Path $runtimeDir "bot-run.json"

function Get-TrackedProcess {
  param(
    [string]$PidFile,
    [string]$CommandPattern
  )

  if (-not (Test-Path $PidFile)) {
    return $null
  }

  $pidText = (Get-Content $PidFile -Raw).Trim()
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId)) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $processInfo -or $processInfo.CommandLine -notmatch [regex]::Escape($CommandPattern)) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  return $process
}

function Get-TrackedSupervisorProcess {
  return Get-TrackedProcess -PidFile $supervisorPidFile -CommandPattern "scripts\bot-supervisor.ps1"
}

function Get-TrackedBotProcess {
  return Get-TrackedProcess -PidFile $pidFile -CommandPattern "dist/src/index.js"
}

$supervisorProcess = Get-TrackedSupervisorProcess
$botProcess = Get-TrackedBotProcess

if ($null -eq $supervisorProcess -and $null -eq $botProcess) {
  Write-Output "Gravity Claw bot is not running."
  exit 0
}

if ($null -ne $supervisorProcess) {
  Stop-Process -Id $supervisorProcess.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $supervisorPidFile -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped bot supervisor. PID: $($supervisorProcess.Id)"
}

if ($null -ne $botProcess) {
  Stop-Process -Id $botProcess.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped bot process. PID: $($botProcess.Id)"
}

Remove-Item $runMetadataFile -Force -ErrorAction SilentlyContinue
