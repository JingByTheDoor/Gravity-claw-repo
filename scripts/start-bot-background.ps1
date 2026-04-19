param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot ".runtime"
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $runtimeDir "bot.pid"
$stdoutLog = Join-Path $logsDir "bot.out.log"
$stderrLog = Join-Path $logsDir "bot.err.log"
$entryScript = Join-Path $repoRoot "dist\src\index.js"
$envFile = Join-Path $repoRoot ".env"

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

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$existingProcess = Get-TrackedBotProcess
if ($null -ne $existingProcess) {
  Write-Output "Gravity Claw bot is already running in the background. PID: $($existingProcess.Id)"
  Write-Output "Logs: $stdoutLog and $stderrLog"
  exit 0
}

if (-not (Test-Path $envFile)) {
  throw "Missing .env file at $envFile"
}

$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}

if (-not $SkipBuild) {
  Write-Output "Building Gravity Claw..."
  & $npmCommand.Path run build

  if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path $entryScript)) {
  throw "Missing build output at $entryScript"
}

Set-Content -Path $stdoutLog -Value ""
Set-Content -Path $stderrLog -Value ""

$process = Start-Process `
  -FilePath $nodeCommand.Path `
  -ArgumentList @("dist/src/index.js") `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id

Start-Sleep -Seconds 2

$runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if ($null -eq $runningProcess) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  $errorTail = ""
  if (Test-Path $stderrLog) {
    $errorTail = (Get-Content $stderrLog -Tail 20) -join [Environment]::NewLine
  }

  throw "The bot exited during startup. Check $stderrLog`n$errorTail"
}

Write-Output "Gravity Claw bot started in the background. PID: $($process.Id)"
Write-Output "Logs: $stdoutLog and $stderrLog"
Write-Output "If startup fails immediately, confirm Ollama is running before starting the bot."
