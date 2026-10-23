@echo off
rem Starts SoulMark on http://localhost:3000 (and your LAN IP for phones).
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist .next\BUILD_ID call npm run build
call npm start
