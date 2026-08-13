@echo off
cd /d "%~dp0"
call "..\node_modules\.bin\vite.CMD" . --host 127.0.0.1 --port 4317 --strictPort --open
pause
