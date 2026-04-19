param(
  [string]$TaskName = "OllamaServe",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$ollamaCommand = Get-Command ollama -ErrorAction Stop
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute $ollamaCommand.Path `
  -Argument "serve"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Starts the Ollama local model server when you log in." `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Output "Scheduled task '$TaskName' is installed."
Write-Output "It will start Ollama when $currentUser logs in."
