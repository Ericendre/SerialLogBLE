@echo off
setlocal
cd /d "%~dp0"
set "PY=python"
%PY% -V >nul 2>&1
if errorlevel 1 set "PY=py -3"
start "GKFlasher Bridge" cmd /k %PY% gkflasher_bridge.py
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8765/
endlocal
