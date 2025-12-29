@echo off
setlocal
cd /d "%~dp0"
start "GKFlasher Bridge" python gkflasher_bridge.py
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8765/
endlocal
