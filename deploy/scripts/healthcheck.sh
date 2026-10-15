#!/bin/bash
# nginx 経由で /health にアクセスし、アプリと DB が正常か確認する（最大 60 秒待機）
set -u
URL="${1:-http://127.0.0.1/health}"

for i in $(seq 1 30); do
  if body=$(curl -fsS --max-time 3 "$URL" 2>/dev/null); then
    echo "ヘルスチェック OK: $body"
    exit 0
  fi
  echo "ヘルスチェック待機中... ($i/30)"
  sleep 2
done

echo "[エラー] ヘルスチェックに失敗しました: $URL" >&2
echo "--- アプリのログ（直近 30 行）---" >&2
journalctl -u aws-training -n 30 --no-pager >&2 || true
exit 1
