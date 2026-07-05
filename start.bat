@echo off
title 9Router AI Gateway
cd /d "D:\AI Agents\ai-gateway"

echo ============================================
echo    9Router AI Gateway - Starting All Services
echo ============================================
echo.

REM Step 1: Install dependencies if needed
if not exist "node_modules" (
    echo [1/4] Installing main gateway dependencies...
    call npm install
) else (
    echo [1/4] Main gateway dependencies found
)

if not exist "health-engine\node_modules" (
    echo [2/4] Installing health engine dependencies...
    cd health-engine && call npm install && cd ..
) else (
    echo [2/4] Health engine dependencies found
)

if not exist "routing-engine\node_modules" (
    echo [3/4] Installing routing engine dependencies...
    cd routing-engine && call npm install && cd ..
) else (
    echo [3/4] Routing engine dependencies found
)

if not exist "observability-engine\node_modules" (
    echo [4/4] Installing observability engine dependencies...
    cd observability-engine && call npm install && cd ..
) else (
    echo [4/4] Observability engine dependencies found
)

echo.
echo ============================================
echo  Starting all 4 servers...
echo ============================================
echo.

REM Step 2: Open browser
start http://localhost:20128

REM Step 3: Start all 4 servers (each in its own window)
start "Health Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\health-engine && node server.js"
start "Routing Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\routing-engine && node server.js"
start "Observability Engine" cmd /c "cd /d D:\AI Agents\ai-gateway\observability-engine && node server.js"

echo  Starting main gateway (this window)...
echo  Health Engine   → http://localhost:20129
echo  Routing Engine  → http://localhost:20130
echo  Observability   → http://localhost:20131
echo  Main Gateway    → http://localhost:20128
echo.
echo  Press Ctrl+C to stop the main gateway.
echo  Close the other windows to stop engines.
echo  ===========================================
echo.

node server.js

pause
