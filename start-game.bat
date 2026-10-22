@echo off
rem Starts the game server so the Quest can open the game. Keep this window open while playing.
title Spider-Man VR server
cd /d "%~dp0"

set "IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress"`) do set "IP=%%i"
if not defined IP set "IP=YOUR-PC-IP"

echo.
echo   In the Quest browser open:   https://%IP%:5173
echo   Then: Advanced - Proceed - ENTER VR
echo.

netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if %errorlevel%==0 (
  echo The server is already running - just open the address above.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo Installing packages, first time only...
  call npm install
)

echo Closing this window stops the game server.
echo.
call npm run dev
pause
