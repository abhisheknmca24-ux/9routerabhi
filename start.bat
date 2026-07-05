@echo off
title 9Router AI Gateway
cd /d "D:\AI Agents\ai-gateway"

echo ============================================
echo    9Router AI Gateway - Launcher
echo ============================================
echo.
echo  Choose startup mode:
echo    [1] Full mode - Main Gateway + All 3 Engines (4 servers)
echo    [2] Lite mode  - Main Gateway only (lowest CPU/RAM)
echo.
set /p mode="Enter 1 or 2: "

REM Install main deps if needed
if not exist "node_modules" (
    echo Installing gateway dependencies...
    call npm install
)

if "%mode%"=="2" goto lite
if not "%mode%"=="1" (
    echo Invalid choice, defaulting to Lite mode
    goto lite
)

REM === FULL MODE ===
if not exist "health-engine\node_modules" (
    echo Installing health engine deps...
    cd health-engine && call npm install && cd ..
)
if not exist "routing-engine\node_modules" (
    echo Installing routing engine deps...
    cd routing-engine && call npm install && cd ..
)
if not exist "observability-engine\node_modules" (
    echo Installing observability engine deps...
    cd observability-engine && call npm install && cd ..
)

echo.
echo ============================================
echo  FULL MODE - Starting all 4 servers
echo ============================================
start http://localhost:20128
start "Health Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\health-engine && node server.js"
start "Routing Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\routing-engine && node server.js"
start "Observability Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\observability-engine && node server.js"
echo  Health Engine   → http://localhost:20129
echo  Routing Engine  → http://localhost:20130
echo  Observability   → http://localhost:20131
echo  Main Gateway    → http://localhost:20128
goto start_gateway

:lite
echo.
echo ============================================
echo  LITE MODE - Starting main gateway only
echo  (Engines not running - lowest CPU/RAM)
echo ============================================
start http://localhost:20128

:start_gateway
echo.
echo  Press Ctrl+C to stop the gateway.
echo ===========================================
echo.
node server.js
pause
