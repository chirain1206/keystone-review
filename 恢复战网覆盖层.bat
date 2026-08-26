@echo off
chcp 65001 >nul
title 恢复战网覆盖层
echo ==========================================
echo   恢复战网游戏内覆盖层
echo   把之前改名的覆盖层程序改回原名。
echo ==========================================
echo.
for /d %%d in ("D:\Battle.net\Battle.net.*") do (
  if exist "%%d\bdk\battlenet.overlay.runtime.exe.disabled" (
    ren "%%d\bdk\battlenet.overlay.runtime.exe.disabled" battlenet.overlay.runtime.exe
    echo 已恢复: %%d\bdk\battlenet.overlay.runtime.exe
  )
)
echo.
echo 完成。
pause
