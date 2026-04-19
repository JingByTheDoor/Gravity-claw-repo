param(
  [string]$TaskName = "OllamaServe",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ollamaCommand = Get-Command ollama -ErrorAction Stop
$startScript = Join-Path $repoRoot "scripts\start-ollama-background.ps1"
$startupFile = Join-Path ([Environment]::GetFolderPath("Startup")) "OllamaServe.cmd"

function Install-StartupEntry {
  $content = "@echo off`r`npowershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`"`r`n"
  Set-Content -Path $startupFile -Value $content -Encoding ASCII
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$installedVia = "scheduled task"

try {
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

Write-Output "Ollama autostart is installed via $installedVia."
Write-Output "It will start Ollama when $currentUser logs in."
