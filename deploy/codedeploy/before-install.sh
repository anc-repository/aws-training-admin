#!/bin/bash
# CodeDeploy BeforeInstall: 前回の展開先をクリアし、前提条件を確認する
set -euo pipefail

rm -rf /opt/aws-training-release
mkdir -p /opt/aws-training-release

if [[ ! -f /etc/aws-training/app.env ]]; then
  echo "[エラー] /etc/aws-training/app.env がありません。EC2 の事前準備（README の「方式3」参照）を行ってください。" >&2
  exit 1
fi
command -v node >/dev/null || { echo "[エラー] Node.js が未インストールです（install-packages.sh を実行してください）" >&2; exit 1; }
command -v nginx >/dev/null || { echo "[エラー] nginx が未インストールです（install-packages.sh を実行してください）" >&2; exit 1; }
