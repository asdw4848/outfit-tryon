@echo off
cd /d "%~dp0"
echo Starting Virtual Try-On Studio on http://localhost:3000 ...
start "" "http://localhost:3000"
node server.mjs
pause
