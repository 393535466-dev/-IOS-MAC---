#!/usr/bin/env bash
# 龙虾脑 · 开机自启安装脚本（launchd 用户代理，零依赖）
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
PLIST_SRC="$DIR/bin/com.lobsterbrain.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/com.lobsterbrain.plist"

mkdir -p "$DIR/logs" "$HOME/Library/LaunchAgents"

# 用真实路径替换模板占位符
sed -e "s|__DIR__|$DIR|g" -e "s|__NODE__|$NODE_BIN|g" "$PLIST_SRC" > "$PLIST_DST"

# 先卸载旧实例，避免重复加载
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "已安装开机自启（launchd）。服务将随 Mac 登录自动启动并在崩溃后自动重启。"
echo "日志：  $DIR/logs/launchd.out.log"
echo "控制台：在 Mac 本机浏览器打开 http://localhost:8787/manage"
echo "卸载：  bash $DIR/bin/uninstall-launchd.sh"
