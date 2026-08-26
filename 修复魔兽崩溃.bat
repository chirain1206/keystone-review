@echo off
chcp 65001 >nul
title 魔兽崩溃修复
echo ==========================================
echo   魔兽世界崩溃修复脚本
echo   请右键本文件 - 以管理员身份运行
echo ==========================================
echo.
echo [1/3] 关闭硬件加速 GPU 计划 (HAGS)...
reg add "HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 1 /f >nul
if %errorlevel%==0 (
  echo       完成：HAGS 已关闭，重启电脑后生效
) else (
  echo       失败！请确认是以管理员身份运行
)
echo.
echo [2/3] 清理魔兽缓存（安全操作，下次进游戏会重新生成）...
if exist "D:\World of Warcraft\_retail_\Cache" rd /s /q "D:\World of Warcraft\_retail_\Cache"
if exist "D:\World of Warcraft\_retail_\GPUCache" rd /s /q "D:\World of Warcraft\_retail_\GPUCache"
echo       完成
echo.
echo [3/3] 结束当前残留的战网覆盖层进程...
taskkill /IM battlenet.overlay.runtime.exe /F >nul 2>&1
echo       完成
echo.
echo 全部完成。请重启电脑后再进游戏测试。
pause
