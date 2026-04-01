# Setup Android SDK PATH for Kuwait Petrol Pump Mobile Build
# Run as Administrator: Right-click → Run with PowerShell

$AndroidHome = "$env:LOCALAPPDATA\Android\Sdk"

# Add to User PATH (not System PATH, no admin needed)
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")

$PathsToAdd = @(
    "$AndroidHome\platform-tools",
    "$AndroidHome\tools",
    "$AndroidHome\cmdline-tools\latest\bin"
)

foreach ($PathToAdd in $PathsToAdd) {
    if ($UserPath -notlike "*$PathToAdd*") {
        $UserPath = "$UserPath;$PathToAdd"
        Write-Host "✓ Added: $PathToAdd" -ForegroundColor Green
    } else {
        Write-Host "○ Already exists: $PathToAdd" -ForegroundColor Yellow
    }
}

[Environment]::SetEnvironmentVariable("Path", $UserPath, "User")

# Set ANDROID_HOME
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $AndroidHome, "User")

Write-Host "`n✓ Android SDK PATH configured!" -ForegroundColor Green
Write-Host "✓ ANDROID_HOME set to: $AndroidHome" -ForegroundColor Green
Write-Host "`n⚠ IMPORTANT: Close and reopen your terminal for changes to take effect" -ForegroundColor Yellow

# Verify installation
Write-Host "`nVerifying Android SDK..." -ForegroundColor Cyan
if (Test-Path "$AndroidHome\platform-tools\adb.exe") {
    Write-Host "✓ ADB found!" -ForegroundColor Green
} else {
    Write-Host "✗ ADB not found. Make sure Android Studio finished installing SDK." -ForegroundColor Red
}
