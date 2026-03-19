@echo off
REM Direct test execution
cd /d "c:\Raj\sppl react\client\oshas-standalone\backend"
node run_test_suite.js
exit /b %errorlevel%
