@echo off
chcp 65001 >nul
title 禁用战网覆盖层
echo ==========================================
echo   禁用战网游戏内覆盖层
echo   原理：把覆盖层程序改名，战网找不到它，
echo   就无法再注入魔兽进程。
echo   可随时用「恢复战网覆盖层.bat」还原。
echo ==========================================
echo.
echo 建议先完全退出战网客户端再继续。
pause
taskkill /IM battlenet.overlay.runtime.exe /F >nul 2>&1
for /d %%d in ("D:\Battle.net\Battle.net.*") do (
  if exist "%%d\bdk\battlenet.overlay.runtime.exe" (
    ren "%%d\bdk\battlenet.overlay.runtime.exe" battlenet.overlay.runtime.exe.disabled
    echo 已禁用: %%d\bdk\battlenet.overlay.runtime.exe
  )
)
echo.
echo 完成。重启战网后生效。
echo 如果战网报错或异常，运行「恢复战网覆盖层.bat」即可还原。
pause
