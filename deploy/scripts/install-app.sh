#!/bin/bash
# ============================================================
# アプリケーションの配置・起動 ※ root で実行（何度実行しても OK）
#   1. ソースを /opt/aws-training に同期
#   2. npm ci で依存パッケージをインストール
#   3. nginx / systemd の設定ファイルを配置
#   4. DB 初期化（テーブル作成・初期データ投入）
#   5. アプリと nginx を再起動し、ヘルスチェック
#
# 使い方: sudo bash deploy/scripts/install-app.sh [ソースディレクトリ]
#   ソースディレクトリ省略時は、このスクリプトが含まれるリポジトリを使用
#
# 事前に /etc/aws-training/app.env を作成しておくこと（deploy/env/app.env.example 参照）
# ============================================================
set -euo pipefail

APP_DIR=/opt/aws-training
ENV_FILE=/etc/aws-training/app.env
SRC_DIR="$(cd "${1:-$(dirname "$0")/../..}" && pwd)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[エラー] $ENV_FILE が存在しません。deploy/env/app.env.example を参考に作成してください。" >&2
  exit 1
fi

echo "=== [1/5] ソースを配置します: $SRC_DIR -> $APP_DIR ==="
mkdir -p "$APP_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude node_modules --exclude .git --exclude .env "$SRC_DIR"/ "$APP_DIR"/
fi
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"

echo "=== [2/5] 依存パッケージをインストールします ==="
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

echo "=== [3/5] nginx / systemd の設定を配置します ==="
if [[ ! -f /etc/nginx/nginx.conf.orig ]]; then
  cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.orig
fi
install -m 644 deploy/nginx/nginx.conf /etc/nginx/nginx.conf
install -m 644 deploy/nginx/aws-training.conf /etc/nginx/conf.d/aws-training.conf
install -m 644 deploy/systemd/aws-training.service /etc/systemd/system/aws-training.service
chown root:nodeapp "$ENV_FILE"
chmod 640 "$ENV_FILE"
nginx -t

echo "=== [4/5] DB を初期化します ==="
ENV_FILE="$ENV_FILE" NODE_ENV=production node scripts/init-db.js

echo "=== [5/5] アプリと nginx を再起動します ==="
systemctl daemon-reload
systemctl enable aws-training
systemctl restart aws-training
systemctl restart nginx

bash "$APP_DIR/deploy/scripts/healthcheck.sh"
echo "=== デプロイが完了しました ==="
