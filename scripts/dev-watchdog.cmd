@echo off
rem fork:dev-watchdog — 计划任务入口（每 5 分钟检查一次，30141 掉线才拉起）
rem 用 .cmd 包一层，省掉 schtasks 的嵌套引号问题；node 找不到时回退到绝对路径。
setlocal
set "NODE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
"%NODE%" "%~dp0dev-watchdog.mjs"
endlocal
