$ErrorActionPreference = "Stop"

$ollamaCommand = Get-Command ollama -ErrorAction Stop
$existingProcess = Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $existingProcess) {
  Write-Output "Ollama is already running. PID: $($existingProcess.Id)"
  exit 0
}

$process = Start-Process `
  -FilePath $ollamaCommand.Path `
  -ArgumentList @("serve") `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 2

$runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if ($null -eq $runningProcess) {
  throw "Ollama exited during startup."
}

Write-Output "Ollama started in the background. PID: $($process.Id)"
