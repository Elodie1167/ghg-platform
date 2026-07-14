@echo off
echo [GHG Platform] 開始重新部署...
cd /d "%~dp0apps\web"
echo [1/2] 建置 Next.js...
call npm run build
if %errorlevel% neq 0 (
  echo [錯誤] Build 失敗，請檢查上方錯誤訊息
  pause
  exit /b 1
)
echo [2/2] 重啟服務...
pm2 restart ghg-platform
echo [完成] 部署成功！網址：http://192.168.6.102:3000
pause
