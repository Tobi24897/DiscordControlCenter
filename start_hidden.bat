@echo off
REM Discord Control Center — silent backend wrapper.
REM Called by "Discord Control Center starten.vbs" (hidden). Fresh boot on every
REM launch: kill any existing instance (incl. orphans), free the port, then start
REM one clean detached backend using the bundled portable Python (no install).
REM No instance is running yet when the kill runs, so it can never target the
REM fresh process started below.

setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
set "PORT=8020"
set "LOCK=%TEMP%\discord_control_center_backend_%PORT%.lock"
set "DATA=%ROOT%data"
set "WRAPLOG=%DATA%\launcher.log"

REM Serialize concurrent launches (e.g. rapid double-clicks).
2>nul mkdir "%LOCK%"
if %errorlevel% neq 0 exit /b 0

if not exist "%DATA%" mkdir "%DATA%"

REM Kill any running/orphaned instance of this app and wait until the port is free.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\kill-existing.ps1" -Root "%ROOT%" -Port %PORT% >> "%WRAPLOG%" 2>&1

cd /d "%ROOT%backend"
set "PYTHONUNBUFFERED=1"
set "NO_BROWSER=1"
start "Discord Control Center Backend" /B "%ROOT%python\pythonw.exe" -u main.py >> "%DATA%\backend.log" 2>&1

REM Wait until the new backend has bound the port (or time out after ~45s).
for /l %%I in (1,1,45) do (
    call :port_listening
    if !errorlevel! equ 0 goto release_lock
    ping -n 2 127.0.0.1 >nul
)

:release_lock
2>nul rmdir "%LOCK%"
endlocal
exit /b 0

:port_listening
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %errorlevel%
