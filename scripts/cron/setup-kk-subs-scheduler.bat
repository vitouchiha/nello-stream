@echo off
REM ── setup-kk-subs-scheduler.bat ────────────────────────────────────────────
REM Task Scheduler setup for monthly KissKH subtitles warming
REM Trigger: 1st day of each month at 11:00 AM
REM

echo Creating monthly Task Scheduler job: StreamFusion-WarmKK-Monthly...
echo.

schtasks /create /tn "StreamFusion-WarmKK-Monthly" /tr "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail\scripts\cron\warm-kk-subs-cron.bat" /sc monthly /d 1 /st 11:00 /f

if %ERRORLEVEL% EQU 0 (
  echo ✓ Task created successfully
  echo   Name: StreamFusion-WarmKK-Monthly
  echo   Trigger: 1st of each month at 11:00 AM
  echo   Action: Run warm-kk-subs-cron.bat
) else (
  echo ✗ Error creating task (exit code: %ERRORLEVEL%)
)

REM Verify
echo.
echo Verifying task...
schtasks /query /tn "StreamFusion-WarmKK-Monthly"

pause
