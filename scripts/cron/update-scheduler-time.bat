@echo off
REM ── update-scheduler-time.bat ──────────────────────────────────────────────
REM Update Task Scheduler time to 10:00 AM (Run as Administrator)
REM

echo [*] Updating Task Scheduler to 10:00 AM...
echo.

schtasks /delete /tn "StreamFusion-WarmGS-Monthly" /f >nul 2>&1

schtasks /create ^
  /tn "StreamFusion-WarmGS-Monthly" ^
  /tr "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail\scripts\cron\warm-gs-episodes-cron.bat" ^
  /sc monthly ^
  /d 1 ^
  /st 10:00 ^
  /f

if %errorlevel% equ 0 (
  echo [OK] Task updated successfully!
  echo.
  schtasks /query /tn "StreamFusion-WarmGS-Monthly"
) else (
  echo [ERROR] Failed to update task
  exit /b 1
)
