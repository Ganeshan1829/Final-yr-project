@echo off
setlocal enabledelayedexpansion
title Smart Timetable System

:: ============================================================
::  Smart Timetable System ? Startup Script
::  Usage:
::    start.bat          -> starts Server + Client + Python ML
::    start.bat --no-ml  -> starts Server + Client only
::    start.bat --test   -> runs all tests and exits
:: ============================================================

for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "CYAN=%ESC%[96m"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "BOLD=%ESC%[1m"
set "RESET=%ESC%[0m"

echo.
echo %CYAN%%BOLD%========================================================%RESET%
echo %CYAN%%BOLD%       Smart Timetable Planning System v1.0            %RESET%
echo %CYAN%%BOLD%========================================================%RESET%
echo.

set "RUN_ML=1"
set "RUN_TESTS=0"

for %%A in (%*) do (
  if "%%A"=="--ml"    set "RUN_ML=1"
  if "%%A"=="--no-ml" set "RUN_ML=0"
  if "%%A"=="--test" set "RUN_TESTS=1"
)

echo %YELLOW%[CHECK]%RESET% Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo %RED%[ERROR]%RESET% Node.js not found. Install from https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo %GREEN%[OK]%RESET%    Node.js !NODE_VER!

echo %YELLOW%[CHECK]%RESET% Checking node_modules...
if not exist "node_modules" (
  echo %YELLOW%[INSTALL]%RESET% Running npm install...
  call npm install
  if %errorlevel% neq 0 (
    echo %RED%[ERROR]%RESET% npm install failed.
    pause & exit /b 1
  )
)
echo %GREEN%[OK]%RESET%    node_modules present

if "%RUN_ML%"=="1" (
  echo %YELLOW%[CHECK]%RESET% Checking Python...
  python --version >nul 2>&1
  if %errorlevel% neq 0 (
    echo %RED%[ERROR]%RESET% Python not found. Install Python 3.9+ from https://python.org
    pause & exit /b 1
  )
  for /f "tokens=*" %%v in ('python --version') do set "PY_VER=%%v"
  echo %GREEN%[OK]%RESET%    !PY_VER!
)

echo.

if "%RUN_TESTS%"=="1" (
  echo %CYAN%%BOLD%[TEST MODE]%RESET% Running full test suite...
  echo.
  call npx vitest run
  set "EXIT_CODE=!errorlevel!"
  echo.
  if !EXIT_CODE! equ 0 (
    echo %GREEN%%BOLD%[PASS]%RESET% All tests passed!
  ) else (
    echo %RED%%BOLD%[FAIL]%RESET% Some tests failed. See output above.
  )
  echo.
  pause
  exit /b !EXIT_CODE!
)

echo %GREEN%%BOLD%Starting services...%RESET%
echo.
echo   %CYAN%Server%RESET%  -^>  http://localhost:4000
echo   %CYAN%Client%RESET%  -^>  http://localhost:5173
if "%RUN_ML%"=="1" (
  echo   %CYAN%ML API%RESET%  -^>  http://localhost:8000
)
echo.
echo %YELLOW%Press Ctrl+C to stop all services.%RESET%
echo.

if "%RUN_ML%"=="1" (
  start "ML Server (port 8000)" cmd /k "title ML Server && python -m uvicorn backend.ml.main:app --port 8000 --host 127.0.0.1 --reload"
  timeout /t 2 /nobreak >nul
)

call npm run dev

echo.
echo %YELLOW%[INFO]%RESET% All services stopped.
echo.
pause
endlocal
