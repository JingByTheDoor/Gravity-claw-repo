param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot ".runtime"
$logsDir = Join-Path $repoRoot "logs"
$supervisorPidFile = Join-Path $runtimeDir "bot-supervisor.pid"
$pidFile = Join-Path $runtimeDir "bot.pid"
$runMetadataFile = Join-Path $runtimeDir "bot-run.json"
$supervisorLog = Join-Path $logsDir "bot-supervisor.log"
$supervisorScript = Join-Path $repoRoot "scripts\bot-supervisor.ps1"

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
  if (-not (Test-Path $pidFile)) {
    return $null
  }
  return Get-TrackedProcess -PidFile $pidFile -CommandPattern "dist/src/index.js"
}

function Get-RunMetadata {
  if (-not (Test-Path $runMetadataFile)) {
    return $null
  }

  try {
    return Get-Content $runMetadataFile -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$existingSupervisor = Get-TrackedSupervisorProcess
if ($null -ne $existingSupervisor) {
  $existingBot = Get-TrackedBotProcess
  $runMetadata = Get-RunMetadata
  if ($null -ne $existingBot) {
    Write-Output "Gravity Claw bot supervisor is already running. Supervisor PID: $($existingSupervisor.Id), bot PID: $($existingBot.Id)"
  } else {
    Write-Output "Gravity Claw bot supervisor is already running. Supervisor PID: $($existingSupervisor.Id)"
  }

  if ($null -ne $runMetadata) {
    Write-Output "Current bot stdout log: $($runMetadata.stdoutLog)"
    Write-Output "Current bot stderr log: $($runMetadata.stderrLog)"
  } else {
    Write-Output "Current bot run logs are not available yet."
  }
  Write-Output "Supervisor log: $supervisorLog"
  exit 0
}

if (-not (Test-Path $supervisorScript)) {
  throw "Missing supervisor script at $supervisorScript"
}

$argumentList = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$supervisorScript`""

if ($SkipBuild) {
  $argumentList += " -SkipInitialBuild"
}

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList $argumentList `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 2

$runningSupervisor = Get-TrackedSupervisorProcess
if ($null -eq $runningSupervisor) {
  $errorTail = ""
  if (Test-Path $supervisorLog) {
    $errorTail = ((Get-Content $supervisorLog -Tail 30) -join [Environment]::NewLine).Trim()
  }

  throw "The bot supervisor exited during startup. Check $supervisorLog`n$errorTail"
}

Write-Output "Gravity Claw bot supervisor started in the background. Supervisor PID: $($runningSupervisor.Id)"
$runMetadata = Get-RunMetadata
if ($null -ne $runMetadata) {
  Write-Output "Current bot stdout log: $($runMetadata.stdoutLog)"
  Write-Output "Current bot stderr log: $($runMetadata.stderrLog)"
} else {
  Write-Output "Current bot run logs are not available yet."
}
Write-Output "Supervisor log: $supervisorLog"
Write-Output "The supervisor rebuilds and restarts the bot automatically when watched files change."
