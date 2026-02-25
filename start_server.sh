#!/bin/bash
# start_server.sh - 启动 x2md 本地服务

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/x2md.log"
PID_FILE="$SCRIPT_DIR/x2md.pid"

# 检查是否已在运行
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "✅ x2md 服务已在运行 (PID: $OLD_PID)"
    exit 0
  fi
fi

echo "🚀 启动 x2md 本地服务..."
cd "$SCRIPT_DIR"
python3 server.py >> "$LOG_FILE" 2>&1 &
PID=$!
echo $PID > "$PID_FILE"
echo "✅ 启动成功！PID: $PID"
echo "📋 日志文件：$LOG_FILE"
