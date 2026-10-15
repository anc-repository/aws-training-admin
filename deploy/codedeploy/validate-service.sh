#!/bin/bash
# CodeDeploy ValidateService: nginx 経由でヘルスチェックを行う（失敗するとデプロイ失敗扱い）
set -euo pipefail

bash /opt/aws-training/deploy/scripts/healthcheck.sh http://127.0.0.1/health
