@echo off
REM E2E Test Orchestration Runner
REM This script starts the backend server, waits for it, runs E2E tests, and cleans up

cd /d "c:\Raj\sppl react\client\oshas-standalone\backend"
echo.
echo ========================================
echo E2E Test Orchestration
echo ========================================
echo.
node e2e_orchestrator.js
pause
