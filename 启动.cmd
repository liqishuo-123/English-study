@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   启动「四六级英语工作台」本地服务...
echo   浏览器会自动打开 http://127.0.0.1:8123/
echo   关闭本窗口即停止服务
echo.
start "" http://127.0.0.1:8123/
node serve.js 8123
pause
