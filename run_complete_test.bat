@echo off
setlocal enabledelayedexpansion

REM Change to the backend directory
cd /d "c:\Raj\sppl react\client\oshas-standalone\backend"

echo ========================================
echo Server and Test Runner
echo ========================================
echo.

REM Check for server using netstat
echo [*] Checking if server is running on port 5000...
netstat -ano | findstr ":5000 " >nul 2>&1
if !errorlevel! equ 0 (
    echo [OK] Server appears to be running on port 5000
) else (
    echo [!] Server is not running. Starting it...
    echo [*] Launching: node server.js
    start "" /b node server.js
    echo [*] Waiting 5 seconds for server to start...
    timeout /t 5 /nobreak
)

REM Run the test
echo.
echo ========================================
echo Running test_advanced_all_structures.js
echo ========================================
echo.

node test_advanced_all_structures.js

REM Capture the exit code
set TEST_EXIT_CODE=%errorlevel%

echo.
echo ========================================
echo Test completed with exit code: %TEST_EXIT_CODE%
echo ========================================

REM Keep window open if running tests
if not "%OS%"=="" timeout /t 5

exit /b %TEST_EXIT_CODE%
