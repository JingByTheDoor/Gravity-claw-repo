param(
  [string]$TaskName = "GravityClawBot",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$startScript = Join-Path $repoRoot "scripts\start-bot-background.ps1"
$startupFile = Join-Path ([Environment]::GetFolderPath("Startup")) "GravityClawBot.cmd"

if (-not (Test-Path $startScript)) {
  throw "Missing start script at $startScript"
}

function Install-StartupEntry {
  $content = "@echo off`r`npowershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`"`r`n"
  Set-Content -Path $startupFile -Value $content -Encoding ASCII
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$installedVia = "scheduled task"

try {
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
} catch {
  Install-StartupEntry
  $installedVia = "Startup folder entry"
}

if ($StartNow) {
  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $startScript) `
    -WindowStyle Hidden | Out-Null
}

Write-Output "Gravity Claw bot autostart is installed via $installedVia."
Write-Output "It will start the bot in the background each time $currentUser logs in."
