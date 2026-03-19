@echo off
REM ── setup-scheduler.bat ────────────────────────────────────────────────────
REM Setup Windows Task Scheduler for monthly warming
REM Run as Administrator
REM

setlocal enabledelayedexpansion

cd /d "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail"

echo [*] Creating monthly scheduled task...
echo.

REM Delete existing task if present
schtasks /delete /tn "StreamFusion-WarmGS-Monthly" /f >nul 2>&1

REM Create new task (runs whether user is logged in or not)
schtasks /create ^
  /tn "StreamFusion-WarmGS-Monthly" ^
  /tr "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail\scripts\cron\warm-gs-episodes-cron.bat" ^
  /sc monthly ^
  /d 1 ^
  /st 05:00 ^
  /rl HIGHEST ^
  /f

if %errorlevel% equ 0 (
  echo.
  echo [OK] Task created successfully!
  echo.
  echo Task Name:     StreamFusion-WarmGS-Monthly
  echo Frequency:     Monthly (1st day of month)
  echo Time:          05:00 AM
  echo Action:        Run warm-gs-episodes-cron.bat
  echo.
  schtasks /query /tn "StreamFusion-WarmGS-Monthly" /v /fo list
) else (
  echo.
  echo [ERROR] Failed to create task. Make sure you're running as Administrator.
  echo.
  exit /b 1
)
