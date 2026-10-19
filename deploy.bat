@echo off
rem Publica el panel en el servidor desde Windows: busca Git Bash y ejecuta deploy.sh.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "GITBASH="
for %%P in ("%ProgramFiles%\Git\bin\bash.exe" "%ProgramFiles(x86)%\Git\bin\bash.exe" "%LocalAppData%\Programs\Git\bin\bash.exe") do (
  if not defined GITBASH if exist "%%~P" set "GITBASH=%%~P"
)
if not defined GITBASH for /f "delims=" %%G in ('where git 2^>nul') do (
  if not defined GITBASH if exist "%%~dpG..\bin\bash.exe" set "GITBASH=%%~dpG..\bin\bash.exe"
)
if not defined GITBASH (
  echo No encuentro Git Bash. Instala Git para Windows desde https://git-scm.com/download/win
  goto fin
)

if not exist ".deploy.env" (
  copy ".deploy.env.example" ".deploy.env" >nul
  echo He creado .deploy.env. Pon los datos de tu servidor, guarda y vuelve a ejecutar deploy.bat.
  start "" notepad ".deploy.env"
  goto fin
)
findstr /c:"IP_DEL_SERVIDOR" ".deploy.env" >nul && (
  echo .deploy.env todavía tiene los datos de ejemplo. Pon la IP de tu servidor, guarda y vuelve a ejecutar deploy.bat.
  start "" notepad ".deploy.env"
  goto fin
)

"%GITBASH%" ./deploy.sh

:fin
echo.
pause
