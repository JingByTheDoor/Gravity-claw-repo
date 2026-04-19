param(
  [string]$TaskName = "GravityClawBot",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$startScript = Join-Path $repoRoot "scripts\start-bot-background.ps1"

if (-not (Test-Path $startScript)) {
  throw "Missing start script at $startScript"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
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
  -Description "Starts the Gravity Claw Telegram bot in the background when you log in." `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Output "Scheduled task '$TaskName' is installed."
Write-Output "It will start the bot in the background each time $currentUser logs in."
