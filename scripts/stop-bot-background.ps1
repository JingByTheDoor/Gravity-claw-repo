$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot ".runtime"
$pidFile = Join-Path $runtimeDir "bot.pid"

function Get-TrackedBotProcess {
  if (-not (Test-Path $pidFile)) {
    return $null
  }

  $pidText = (Get-Content $pidFile -Raw).Trim()
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId)) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $processInfo -or $processInfo.CommandLine -notmatch [regex]::Escape("dist/src/index.js")) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  return $process
}

$process = Get-TrackedBotProcess
if ($null -eq $process) {
  Write-Output "Gravity Claw bot is not running."
  exit 0
}

Stop-Process -Id $process.Id -Force
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue

Write-Output "Gravity Claw bot stopped. PID: $($process.Id)"
