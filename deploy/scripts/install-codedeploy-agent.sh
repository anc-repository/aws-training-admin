#!/bin/bash
# ============================================================
# CodeDeploy エージェントのインストール（方式3: CodePipeline 用）※ root で 1 回だけ実行
# 使い方: sudo bash deploy/scripts/install-codedeploy-agent.sh
# ============================================================
set -euo pipefail

TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
echo "リージョン: $REGION"

dnf install -y ruby wget
cd /tmp
wget -q "https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install" -O codedeploy-install
chmod +x codedeploy-install
./codedeploy-install auto
rm -f codedeploy-install

systemctl enable --now codedeploy-agent
systemctl status codedeploy-agent --no-pager | head -5
