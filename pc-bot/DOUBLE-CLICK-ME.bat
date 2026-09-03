@echo off
setlocal
set "INSTALL=%USERPROFILE%\MT5-Demo"
set "URL=https://trading-production-2c95.up.railway.app/pc-files/mt5_demo.py"
if not exist "%INSTALL%" mkdir "%INSTALL%"

if exist "%~dp0mt5_demo.py" copy /Y "%~dp0mt5_demo.py" "%INSTALL%\mt5_demo.py" >nul
if not exist "%INSTALL%\mt5_demo.py" (
  curl.exe -L --fail -o "%INSTALL%\mt5_demo.py" "%URL%" 2>nul
)

if not exist "%INSTALL%\mt5_demo.py" (
  echo Could not save the trader file.
  echo Right-click the zip in Downloads, click Extract All, then run this from the extracted folder.
  pause
  exit /b 1
)

cd /d "%INSTALL%"
echo.
echo Installed at %INSTALL%
echo Open MetaTrader 5 and log into Demo first. This window stays open.
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
