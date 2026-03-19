@echo off
setlocal enabledelayedexpansion

cd /d "c:\Raj\sppl react\client\oshas-standalone\backend"

REM Start the server in background and capture its PID
echo Starting backend server...
start /B node server.js > nul 2>&1

REM Wait 10 seconds for server to initialize
echo Waiting 10 seconds for server to initialize...
timeout /t 10 /nobreak

REM Run health check
echo.
echo Running health check...
node -e "const http=require('http');const req=http.request({hostname:'localhost',port:5000,path:'/api/health',method:'GET'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log('Health:',r.statusCode,d))});req.on('error',e=>console.log('ERROR:',e.message));req.end();"

REM Wait a moment for health check to complete
timeout /t 2 /nobreak

REM Run E2E tests
echo.
echo ===== Starting E2E Tests =====
node e2e_test_runner.js

REM Wait a moment for tests to complete
timeout /t 2 /nobreak

REM Kill all node processes
echo.
echo Stopping server...
taskkill /IM node.exe /F 2>nul

exit /b 0
