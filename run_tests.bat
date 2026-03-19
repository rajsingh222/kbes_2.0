@echo off
cd /d "c:\Raj\sppl react\client\oshas-standalone\backend"

echo Checking if server is running on port 5000...
timeout /t 2 /nobreak

echo Starting tests...
node test_advanced_all_structures.js

pause
