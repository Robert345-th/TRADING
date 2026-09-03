@echo off
cd /d "%~dp0"
echo Connecting your MT5 DEMO account to Trade Tracker...
echo Open MetaTrader 5 and log into DEMO first.
python -m pip install -q MetaTrader5
python mt5_demo.py
pause
