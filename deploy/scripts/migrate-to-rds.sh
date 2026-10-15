#!/bin/bash
# ============================================================
# 手動で作成した PostgreSQL（EC2 上のローカル DB）から RDS へデータを自動移行する
#   pg_dump でスキーマ＋データを取り出し、そのまま RDS に流し込みます。
#
# 使い方:
#   export SRC_HOST=127.0.0.1 SRC_PORT=5432 SRC_USER=appuser SRC_PASSWORD=xxx SRC_DB=aws_training
#   export DST_HOST=<RDSエンドポイント> DST_PORT=5432 DST_USER=dbadmin DST_PASSWORD=xxx DST_DB=aws_training
#   bash deploy/scripts/migrate-to-rds.sh
#
# 注意: 移行先 DB に同名テーブルがある場合は削除して作り直します（--clean）
# ============================================================
set -euo pipefail

: "${SRC_HOST:?SRC_HOST を設定してください}" "${SRC_USER:?}" "${SRC_PASSWORD:?}" "${SRC_DB:?}"
: "${DST_HOST:?DST_HOST を設定してください}" "${DST_USER:?}" "${DST_PASSWORD:?}" "${DST_DB:?}"
SRC_PORT="${SRC_PORT:-5432}"
DST_PORT="${DST_PORT:-5432}"
DUMP_FILE="/tmp/aws_training_$(date +%Y%m%d%H%M%S).sql"

echo "=== [1/4] 移行先 RDS への接続を確認します ==="
PGPASSWORD="$DST_PASSWORD" PGSSLMODE=require psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d postgres -Atc "SELECT version();"

echo "=== [2/4] 移行先データベース $DST_DB を用意します ==="
exists=$(PGPASSWORD="$DST_PASSWORD" PGSSLMODE=require psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname = '$DST_DB'")
if [[ "$exists" != "1" ]]; then
  PGPASSWORD="$DST_PASSWORD" PGSSLMODE=require psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d postgres -c "CREATE DATABASE \"$DST_DB\" ENCODING 'UTF8'"
fi

echo "=== [3/4] 移行元からダンプを取得します: $DUMP_FILE ==="
PGPASSWORD="$SRC_PASSWORD" pg_dump -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" \
  --no-owner --no-privileges --clean --if-exists > "$DUMP_FILE"
echo "ダンプサイズ: $(du -h "$DUMP_FILE" | cut -f1)"

echo "=== [4/4] RDS にリストアします ==="
PGPASSWORD="$DST_PASSWORD" PGSSLMODE=require psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" \
  -v ON_ERROR_STOP=1 -q -f "$DUMP_FILE"

echo "=== 移行結果（件数比較）==="
for t in users employees login_history; do
  src=$(PGPASSWORD="$SRC_PASSWORD" psql -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" -Atc "SELECT COUNT(*) FROM $t")
  dst=$(PGPASSWORD="$DST_PASSWORD" PGSSLMODE=require psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" -Atc "SELECT COUNT(*) FROM $t")
  printf "  %-15s 移行元: %5s 件 / RDS: %5s 件 %s\n" "$t" "$src" "$dst" "$([[ "$src" == "$dst" ]] && echo OK || echo '※不一致')"
done

rm -f "$DUMP_FILE"
echo "移行が完了しました。/etc/aws-training/app.env の DB_HOST 等を RDS に切り替えて、アプリを再起動してください。"
