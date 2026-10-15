#!/bin/bash
# CodeDeploy AfterInstall: 展開されたリビジョンを本番ディレクトリへ反映し、DB 初期化・再起動する
set -euo pipefail

bash /opt/aws-training-release/deploy/scripts/install-app.sh /opt/aws-training-release
