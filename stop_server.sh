#!/bin/bash
# stop_server.sh - 停止 x2md 本地服务

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/x2md.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    rm "$PID_FILE"
    echo "🛑 x2md 服务已停止 (PID: $PID)"
  else
    rm "$PID_FILE"
    echo "⚠️  服务未在运行"
  fi
else
  echo "⚠️  未找到 PID 文件，服务可能未启动"
fi
