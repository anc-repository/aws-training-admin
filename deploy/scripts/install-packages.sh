#!/bin/bash
# ============================================================
# EC2（Amazon Linux 2023）の初期セットアップ ※ root で 1 回だけ実行
#   - Node.js 22 / nginx / git / rsync / PostgreSQL クライアント のインストール
#   - アプリ実行ユーザー nodeapp の作成
#   - RDS の CA 証明書バンドルのダウンロード
# 使い方: sudo bash deploy/scripts/install-packages.sh
# ============================================================
set -euo pipefail

echo "=== パッケージを更新します ==="
dnf -y update

echo "=== Node.js 22 をインストールします（NodeSource リポジトリ）==="
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi
node -v && npm -v

echo "=== nginx / git / rsync / PostgreSQL クライアントをインストールします ==="
dnf install -y nginx git rsync jq openssl
dnf install -y postgresql16 || dnf install -y postgresql15
psql --version

echo "=== アプリ実行ユーザー nodeapp を作成します ==="
id nodeapp >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin nodeapp

echo "=== 設定ディレクトリと RDS の CA 証明書を用意します ==="
mkdir -p /etc/aws-training /opt/aws-training
curl -fsSL -o /etc/aws-training/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
chmod 644 /etc/aws-training/rds-ca.pem

systemctl enable nginx
echo "=== 初期セットアップが完了しました ==="
