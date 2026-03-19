# Monitor warm-kk-subs-fast.js progress
param([int]$Interval = 30)

$logFile = "kk-subs-warm-full.log"
$stateFile = "kk-subs-warm-state.json"

while ($true) {
    Clear-Host
    Write-Host "=== KK Subs Fast Warming Monitor ===" -ForegroundColor Cyan
    Write-Host "Time: $(Get-Date -Format 'HH:mm:ss')"
    Write-Host ""

    # State file stats
    if (Test-Path $stateFile) {
        $raw = node -e "const s=require('./$stateFile');const d=s.done||s;const k=Object.keys(d);const w=k.filter(x=>d[x]===1).length;const n=k.filter(x=>d[x]==='no-ita').length;const f=k.filter(x=>d[x]==='failed').length;console.log(k.length+'|'+w+'|'+n+'|'+f)"
        $parts = $raw -split '\|'
        Write-Host "State File:" -ForegroundColor Yellow
        Write-Host "  Total processed: $($parts[0])"
        Write-Host "  Warmed (ITA):    $($parts[1])" -ForegroundColor Green
        Write-Host "  No ITA:          $($parts[2])" -ForegroundColor DarkGray
        Write-Host "  Failed:          $($parts[3])" -ForegroundColor Red
        Write-Host "  Remaining:       $(9707 - [int]$parts[0]) / 9707"
    }

    Write-Host ""

    # Cache files
    $cacheFiles = @(Get-ChildItem kk-subs-cache -Recurse -File -ErrorAction SilentlyContinue)
    $cacheDirs = @(Get-ChildItem kk-subs-cache -Directory -ErrorAction SilentlyContinue)
    Write-Host "Cache: $($cacheFiles.Count) files in $($cacheDirs.Count) series dirs" -ForegroundColor Yellow

    Write-Host ""

    # Log tail
    if (Test-Path $logFile) {
        $logSize = [math]::Round((Get-Item $logFile).Length / 1MB, 2)
        Write-Host "Log ($logSize MB) - last 15 lines:" -ForegroundColor Yellow
        Get-Content $logFile -Tail 15
    }

    Write-Host ""

    # Check if node process is still running
    $nodeProcs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*warm-kk-subs-fast*" }
    if ($nodeProcs) {
        Write-Host "Process: RUNNING (PID $($nodeProcs.ProcessId))" -ForegroundColor Green
    } else {
        Write-Host "Process: NOT RUNNING" -ForegroundColor Red
        Write-Host "Warming may have completed or crashed. Check log for details."
        break
    }

    Write-Host "`nRefresh in ${Interval}s... (Ctrl+C to stop monitor)" -ForegroundColor DarkGray
    Start-Sleep -Seconds $Interval
}
