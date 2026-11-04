@echo off
rem Double-click friendly wrapper: runs install-windows.ps1 without changing the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
