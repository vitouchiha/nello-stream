# Monitor warm-gs-episodes.js and auto-restart on crash
# Checks every 15 minutes, resumes if process dies

$dir = "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail"
$logFile = "$dir\gs-warm-cron.log"

function Get-TimeStamp {
    return "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]"
}

# Append to log
function Log {
    param([string]$msg)
    $ts = Get-TimeStamp
    Add-Content -Path $logFile -Value "$ts $msg"
    Write-Host "$ts $msg" -ForegroundColor Cyan
}

# Find process by command line containing warm-gs-episodes
function Get-WarmGsProcess {
    $procs = Get-Process node -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        try {
            $cmdline = (Get-WmiObject Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdline -and $cmdline -like "*warm-gs-episodes*") {
                return $p
            }
        }
        catch { }
    }
    return $null
}

# Start warm-gs-episodes with 4GB heap
function Start-WarmGs {
    Log "Starting warm-gs-episodes with 4GB heap..."
    Push-Location $dir
    & node --max-old-space-size=4096 warm-gs-episodes.js --continue --deploy
    Pop-Location
}

# Main monitoring loop
Log "Monitor started, checking every 15 minutes..."

while ($true) {
    # Check if process is running
    $proc = Get-WarmGsProcess
    
    if ($null -eq $proc) {
        Log "Process not running, starting..."
        Start-WarmGs
        Start-Sleep -Seconds 5
        $proc = Get-WarmGsProcess
    }
    
    if ($null -eq $proc) {
        Log "Failed to start, retrying in 1 minute..."
        Start-Sleep -Seconds 60
        continue
    }
    
    # Check last lines for completion
    $lastLines = @(Get-Content $logFile -Tail 10 -ErrorAction SilentlyContinue)
    $logText = $lastLines -join "`n"
    
    if ($logText -match "completed|all.*series.*processed") {
        Log "Process completed successfully!"
        break
    }
    
    # Check for crashes
    if ($logText -match "FATAL ERROR|heap limit|out of memory") {
        Log "Process crashed, restarting in 30s..."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 30
        continue
    }
    
    # Log status
    $elapsed = (Get-Date) - $proc.StartTime
    $mem = [math]::Round($proc.WorkingSet / 1MB, 0)
    Log "Running (PID: $($proc.Id), Elapsed: $($elapsed.ToString('hh\:mm\:ss')), Memory: ${mem}MB)"
    
    # Wait 15 minutes
    Write-Host "Waiting 15 minutes until next check..." -ForegroundColor Gray
    Start-Sleep -Seconds 900
}

Log "Monitoring stopped"
