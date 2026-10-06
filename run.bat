@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto folder_error

if /i "%~1"=="backend" goto backend
if /i "%~1"=="frontend" goto frontend

title NetSmonitor Launcher
echo NetSmonitor - Start API and Web
echo Project: "%CD%"
echo.

if not exist "run_backend.py" goto project_missing
if not exist "package.json" goto project_missing

call :find_python
if not defined NETSMONITOR_PYTHON goto python_missing
"%NETSMONITOR_PYTHON%" --version >nul 2>&1
if errorlevel 1 goto python_missing
if not defined NETSMONITOR_HAS_VENV (
    echo Preparing the project Python environment...
    "%NETSMONITOR_PYTHON%" -m venv .venv
    if errorlevel 1 goto setup_error
    set "NETSMONITOR_PYTHON=%CD%\.venv\Scripts\python.exe"
)
"%NETSMONITOR_PYTHON%" -c "import fastapi, uvicorn, pysnmp, pyasn1, pydantic, websockets, scapy" >nul 2>&1
if errorlevel 1 (
    echo Installing Python dependencies. Internet access is required on first run...
    "%NETSMONITOR_PYTHON%" -m pip install -r backend\requirements.txt
    if errorlevel 1 goto setup_error
)
"%NETSMONITOR_PYTHON%" -c "import fastapi, uvicorn, pysnmp, pyasn1, pydantic, websockets, scapy" >nul 2>&1
if errorlevel 1 goto python_dependencies_missing

where node.exe >nul 2>&1
if errorlevel 1 goto node_missing
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_missing
if not exist "node_modules\vite\bin\vite.js" (
    echo Installing web dependencies. Internet access is required on first run...
    call npm.cmd ci
    if errorlevel 1 goto setup_error
)
if not exist "node_modules\vite\bin\vite.js" goto web_dependencies_missing
if /i "%~1"=="check" (
    echo Python and web dependencies are ready.
    exit /b 0
)

set "NETSMONITOR_REUSE_API="
powershell.exe -NoProfile -Command "$p = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue; if (-not $p) { exit 0 }; try { $h = Invoke-RestMethod 'http://localhost:8000/api/health' -TimeoutSec 3; if ($h.service -eq 'SNMP Network Monitor Backend' -and $h.status -eq 'online') { exit 10 } } catch {}; exit 2"
if errorlevel 11 goto port_check_error
if errorlevel 10 set "NETSMONITOR_REUSE_API=1"
if not defined NETSMONITOR_REUSE_API if errorlevel 1 goto api_port_busy
set "NETSMONITOR_REUSE_WEB="
powershell.exe -NoProfile -Command "$p = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue; if (-not $p) { exit 0 }; try { $w = Invoke-WebRequest 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 3; if ($w.Content.Contains('<title>NetSmonitor</title>') -and $w.Content.Contains('/@vite/client')) { exit 10 } } catch {}; exit 2"
if errorlevel 11 goto port_check_error
if errorlevel 10 set "NETSMONITOR_REUSE_WEB=1"
if not defined NETSMONITOR_REUSE_WEB if errorlevel 1 goto web_port_busy

if defined NETSMONITOR_REUSE_API (
    echo The NetSmonitor API is already running. Reusing it.
) else (
    cmd.exe /d /c exit 0
    start "NetSmonitor - API" "%ComSpec%" /d /c call "%~f0" backend
    if errorlevel 1 goto launch_error
)
if defined NETSMONITOR_REUSE_WEB (
    echo The NetSmonitor web server is already running. Reusing it.
    cmd.exe /d /c exit 0
    start "" "http://localhost:5173/"
    if errorlevel 1 goto launch_error
) else (
    cmd.exe /d /c exit 0
    start "NetSmonitor - Web" "%ComSpec%" /d /c call "%~f0" frontend
    if errorlevel 1 goto launch_error
)

echo API: http://localhost:8000
echo Web: http://localhost:5173
echo The browser opens when the web server is ready.
echo Keep both server windows open. Press Ctrl+C in each window to stop.
exit /b 0

:backend
title NetSmonitor - API
call :find_python
if not defined NETSMONITOR_PYTHON goto python_missing
set "PYTHONUTF8=1"
echo Starting FastAPI on http://localhost:8000 ...
"%NETSMONITOR_PYTHON%" run_backend.py
set "NETSMONITOR_EXIT_CODE=%ERRORLEVEL%"
echo.
echo API stopped. Exit code: %NETSMONITOR_EXIT_CODE%
pause
exit /b %NETSMONITOR_EXIT_CODE%

:frontend
title NetSmonitor - Web
echo Starting the web server on http://localhost:5173 ...
call npm.cmd run dev -- --port 5173 --strictPort --open
set "NETSMONITOR_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Web server stopped. Exit code: %NETSMONITOR_EXIT_CODE%
pause
exit /b %NETSMONITOR_EXIT_CODE%

:find_python
set "NETSMONITOR_PYTHON="
set "NETSMONITOR_HAS_VENV="
for %%P in (".venv\Scripts\python.exe" "venv\Scripts\python.exe" "backend\.venv\Scripts\python.exe" "backend\venv\Scripts\python.exe") do (
    if not defined NETSMONITOR_PYTHON if exist "%%~P" set "NETSMONITOR_PYTHON=%%~fP"
)
if defined NETSMONITOR_PYTHON (
    set "NETSMONITOR_HAS_VENV=1"
    exit /b 0
)
where python.exe >nul 2>&1
if not errorlevel 1 set "NETSMONITOR_PYTHON=python.exe"
if defined NETSMONITOR_PYTHON exit /b 0
where py.exe >nul 2>&1
if not errorlevel 1 set "NETSMONITOR_PYTHON=py.exe"
exit /b 0

:folder_error
echo ERROR: Cannot open the project folder.
goto fail

:project_missing
echo ERROR: Keep run.bat in the project root beside run_backend.py and package.json.
goto fail

:python_missing
echo ERROR: Python was not found or cannot run.
echo Install Python 3 and enable Add Python to PATH, then try again.
goto fail

:python_dependencies_missing
echo ERROR: Python dependencies are missing or cannot be imported.
echo Run this command from the project folder:
echo "%NETSMONITOR_PYTHON%" -m pip install -r backend\requirements.txt
goto fail

:node_missing
echo ERROR: Node.js and npm must be installed and available in PATH.
goto fail

:web_dependencies_missing
echo ERROR: Web dependencies are missing.
echo Run npm ci from the project folder, then try again.
goto fail

:launch_error
echo ERROR: Cannot open a server window. Check any window already opened.
goto fail

:setup_error
echo ERROR: Dependency setup failed. See the installation error above.
echo Check your Internet connection and Python installation, then try again.
goto fail

:api_port_busy
echo ERROR: Another program is using port 8000, not the NetSmonitor API.
echo Stop that program yourself before starting NetSmonitor.
echo No existing process has been stopped by this launcher.
goto fail

:web_port_busy
echo ERROR: Another program is using port 5173, not the NetSmonitor web server.
echo Stop that program yourself before starting NetSmonitor.
goto fail

:port_check_error
echo ERROR: Cannot check server ports. Windows PowerShell must be available.
goto fail

:fail
echo.
pause
exit /b 1
