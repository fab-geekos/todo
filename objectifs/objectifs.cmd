@echo off
rem Lanceur Windows : "objectifs cloture", "objectifs import" (voir README.md).
rem chcp 65001 = UTF-8, sinon les accents s affichent mal dans cmd.
chcp 65001 >nul
node "%~dp0src\cli.js" %*
