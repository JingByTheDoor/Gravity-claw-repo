param(
  [string]$TaskName = "GravityClawBot"
)

$ErrorActionPreference = "Stop"

$startupFile = Join-Path ([Environment]::GetFolderPath("Startup")) "GravityClawBot.cmd"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "Scheduled task '$TaskName' is not installed."
} else {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Scheduled task '$TaskName' has been removed."
}

if (Test-Path $startupFile) {
  Remove-Item $startupFile -Force
  Write-Output "Startup folder entry '$startupFile' has been removed."
}
