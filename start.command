#!/bin/bash
cd "$(dirname "$0")"
# 自动释放 8787 端口：若已有旧服务在跑（比如上次没关的窗口），先顶掉它再启动，避免端口冲突
PID=$(lsof -ti tcp:8787 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  echo "已释放旧服务端口"
fi
echo "龙虾脑服务启动中… (http://localhost:8787  按 Cmd+. 或 Ctrl+C 退出)"
node app.js
