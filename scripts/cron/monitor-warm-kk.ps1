#!/usr/bin/env pwsh
# Monitor KissKH warming every 30 seconds

$stateFile = "kk-subs-warm-state.json"
$cacheDir = "kk-subs-cache"
$checkInterval = 30
$startTime = Get-Date
$lastProcessed = 0
$lastTime = Get-Date

Write-Host "Starting KK warming monitor..." -ForegroundColor Cyan

while ($true) {
    if (!(Test-Path $stateFile)) {
        Write-Host "[$(Get-Date -Format HH:mm:ss)] Waiting..." -ForegroundColor Yellow
    }
    else {
        $state = Get-Content $stateFile | ConvertFrom-Json
        $cacheCount = (Get-ChildItem $cacheDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
        
        $now = Get-Date
        $elapsed = $now - $startTime
        $processed = $state.stats.processed
        $rate = if ($elapsed.TotalMinutes -gt 0) { [math]::Round($processed / $elapsed.TotalMinutes, 1) } else { 0 }
        $remaining = 744 - $processed
        $eta = if ($rate -gt 0) { [math]::Round($remaining / $rate, 0) } else { 0 }
        
        Write-Host "[$(Get-Date -Format HH:mm:ss)] P:$processed|W:$($state.stats.warmed)|F:$($state.stats.failed)|C:$cacheCount | Speed:$rate ep/min | ETA:${eta}min" -ForegroundColor Green
        
        if ($rate -lt 0.3) {
            Write-Host "  WARNING: Slow! Browser throttled. Consider --limit 50 for quick test." -ForegroundColor Red
        }
    }
    
    Start-Sleep -Seconds $checkInterval
}
