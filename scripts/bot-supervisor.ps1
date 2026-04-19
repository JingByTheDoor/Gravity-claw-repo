param(
  [int]$PollSeconds = 5,
  [switch]$SkipInitialBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot ".runtime"
$logsDir = Join-Path $repoRoot "logs"
$supervisorPidFile = Join-Path $runtimeDir "bot-supervisor.pid"
$botPidFile = Join-Path $runtimeDir "bot.pid"
$supervisorLog = Join-Path $logsDir "bot-supervisor.log"
$stdoutLog = Join-Path $logsDir "bot.out.log"
$stderrLog = Join-Path $logsDir "bot.err.log"
$entryScript = Join-Path $repoRoot "dist\src\index.js"
$envFile = Join-Path $repoRoot ".env"
$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if ($null -eq $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-SupervisorLog {
  param(
    [string]$Message,
    [string]$Level = "info"
  )

  $timestamp = [DateTime]::UtcNow.ToString("o")
  Add-Content -Path $supervisorLog -Value "$timestamp [$($Level.ToUpperInvariant())] $Message"
}

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

function Get-WatchedFileItems {
  $items = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

  $topLevelFiles = @(
    ".env",
    ".env.local",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "node_modules\.package-lock.json"
  )

  foreach ($relativePath in $topLevelFiles) {
    $fullPath = Join-Path $repoRoot $relativePath
    if (Test-Path $fullPath) {
      $items.Add((Get-Item $fullPath))
    }
  }

  $srcRoot = Join-Path $repoRoot "src"
  if (Test-Path $srcRoot) {
    foreach ($file in (Get-ChildItem -Path $srcRoot -Recurse -File | Sort-Object FullName)) {
      $items.Add($file)
    }
  }

  return $items
}

function Get-SourceSignature {
  $lines = Get-WatchedFileItems | ForEach-Object {
    "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)"
  }

  return ($lines -join "`n")
}

function Get-BotProcess {
  return Get-TrackedProcess -PidFile $botPidFile -CommandPattern "dist/src/index.js"
}

function Stop-BotProcess {
  $process = Get-BotProcess
  if ($null -eq $process) {
    Remove-Item $botPidFile -Force -ErrorAction SilentlyContinue
    return
  }

  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $botPidFile -Force -ErrorAction SilentlyContinue
  Write-SupervisorLog "Stopped bot process. PID: $($process.Id)"
}

function Start-BotProcess {
  if (-not (Test-Path $envFile)) {
    throw "Missing .env file at $envFile"
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

  Set-Content -Path $botPidFile -Value $process.Id
  Start-Sleep -Seconds 2

  $runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if ($null -eq $runningProcess) {
    Remove-Item $botPidFile -Force -ErrorAction SilentlyContinue
    $errorTail = ""
    if (Test-Path $stderrLog) {
      $errorTail = ((Get-Content $stderrLog -Tail 20) -join [Environment]::NewLine).Trim()
    }

    throw "Bot exited during startup. $errorTail"
  }

  Write-SupervisorLog "Started bot process. PID: $($process.Id)"
}

function Invoke-NpmBuild {
  Write-SupervisorLog "Running npm run build."
  $output = & $npmCommand.Path run build 2>&1
  $exitCode = $LASTEXITCODE

  $outputText = ($output | Out-String).Trim()
  if ($outputText.Length -gt 0) {
    foreach ($line in ($outputText -split "\r?\n")) {
      if ($line.Trim().Length -gt 0) {
        Write-SupervisorLog "build> $line"
      }
    }
  }

  if ($exitCode -ne 0) {
    throw "npm run build failed with exit code $exitCode."
  }
}

function Deploy-Bot {
  param(
    [string]$SourceSignature
  )

  try {
    Invoke-NpmBuild
    Stop-BotProcess
    Start-BotProcess
    Write-SupervisorLog "Deployment succeeded."
    return $SourceSignature
  } catch {
    Write-SupervisorLog "Deployment failed: $($_.Exception.Message)" "error"

    if ($null -eq (Get-BotProcess) -and (Test-Path $entryScript)) {
      try {
        Write-SupervisorLog "Build failed while no bot was running. Starting the last built dist output instead."
        Start-BotProcess
        Write-SupervisorLog "Fallback start succeeded."
      } catch {
        Write-SupervisorLog "Fallback start failed: $($_.Exception.Message)" "error"
      }
    }

    return $null
  }
}

$script:deployedSignature = $null
$script:lastAttemptedSignature = $null
$script:skipRetrySignature = $null

Set-Content -Path $supervisorPidFile -Value $PID
Write-SupervisorLog "Supervisor started. PID: $PID"

try {
  $currentSignature = Get-SourceSignature

  if ($SkipInitialBuild) {
    Write-SupervisorLog "Starting from existing dist output without an initial build."
    Start-BotProcess
    $script:deployedSignature = $currentSignature
    $script:lastAttemptedSignature = $currentSignature
  } else {
    $script:lastAttemptedSignature = $currentSignature
    $result = Deploy-Bot -SourceSignature $currentSignature
    if ($null -ne $result) {
      $script:deployedSignature = $result
    }
  }

  while ($true) {
    Start-Sleep -Seconds $PollSeconds

    $currentSignature = Get-SourceSignature
    $botProcess = Get-BotProcess

    if ($null -eq $botProcess) {
      if ($null -ne $script:deployedSignature -and $currentSignature -eq $script:deployedSignature) {
        try {
          Write-SupervisorLog "Bot process exited unexpectedly. Restarting the last deployed build."
          Start-BotProcess
          $script:skipRetrySignature = $null
        } catch {
          if ($script:skipRetrySignature -ne $currentSignature) {
            Write-SupervisorLog "Restart failed: $($_.Exception.Message)" "error"
            $script:skipRetrySignature = $currentSignature
          }
        }

        continue
      }
    }

    if ($currentSignature -eq $script:deployedSignature) {
      continue
    }

    if ($currentSignature -eq $script:lastAttemptedSignature) {
      continue
    }

    Write-SupervisorLog "Detected source change. Rebuilding and redeploying."
    $script:lastAttemptedSignature = $currentSignature
    $result = Deploy-Bot -SourceSignature $currentSignature
    if ($null -ne $result) {
      $script:deployedSignature = $result
      $script:skipRetrySignature = $null
    }
  }
} finally {
  Stop-BotProcess
  Remove-Item $supervisorPidFile -Force -ErrorAction SilentlyContinue
  Write-SupervisorLog "Supervisor stopped."
}
