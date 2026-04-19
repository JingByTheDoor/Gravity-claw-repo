param(
  [string]$TaskName = "OllamaServe"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "Scheduled task '$TaskName' is not installed."
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Scheduled task '$TaskName' has been removed."
