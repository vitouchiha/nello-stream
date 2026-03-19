@echo off
REM ── warm-kk-subs-cron.bat ──────────────────────────────────────────────────
REM Scheduled task: warm KissKH Italian subtitles cache (decrypt + KV persist)
REM
REM Programma: C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail\scripts\cron\warm-kk-subs-cron.bat
REM Avvia in:  C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail
REM Attivazione consigliata: Giornaliero alle 07:00
REM

cd /d "C:\Users\vitob\Desktop\bot telegram\Streaming Koreano\StreamFusionMail"

echo [%date% %time%] Starting warm-kk-subs... >> kk-subs-warm-cron.log 2>&1
node scripts/warm/warm-kk-subs.js --continue >> kk-subs-warm-cron.log 2>&1
echo [%date% %time%] Done. >> kk-subs-warm-cron.log 2>&1
