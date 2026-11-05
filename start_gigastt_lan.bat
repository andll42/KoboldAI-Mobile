@echo off
setlocal
where gigastt >nul 2>nul || (
  echo ERROR: gigastt command was not found in PATH.
  echo Install GigaSTT or activate its environment, then run this file again.
  exit /b 1
)
echo Starting GigaSTT for the trusted private Wi-Fi LAN.
echo Android app Origin allowed: https://localhost
echo Do NOT expose TCP 9876 to the public Internet.
gigastt serve --host 0.0.0.0 --port 9876 --bind-all --allow-origin https://localhost
endlocal
