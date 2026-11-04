#!/usr/bin/env bash
# 龙虾脑 · 卸载开机自启（停止并由 launchd 取消管理）
set -e

PLIST_DST="$HOME/Library/LaunchAgents/com.lobsterbrain.plist"

launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"

echo "已卸载开机自启，并停止了当前服务。"
echo "如需重新启用：bash $HOME/$(basename "$0" | sed 's/uninstall/install/')"
