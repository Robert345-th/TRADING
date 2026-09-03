@echo off
cd /d "%~dp0"
echo.
echo This uses the DEMO account in MetaTrader 5 on THIS computer.
echo Open MT5 and log into Demo first, then this window stays open.
echo.
where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (
  echo Python is not installed. Install it from https://www.python.org/downloads/
  echo Tick "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)
%PY% -m pip install -q MetaTrader5
%PY% mt5_demo.py
pause
