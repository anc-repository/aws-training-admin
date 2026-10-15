# 方式3: Git リポジトリからの CI/CD デプロイ

`git push` するだけで、ビルド → テスト → EC2 へのデプロイが自動で行われる仕組みを作ります。
2 つのパターンを用意しています（どちらか一方を選んで実施してください）。

| パターン | 仕組み | 特徴 |
|---|---|---|
| **3-A**（推奨） | GitHub → **CodePipeline** → **CodeBuild** → **CodeDeploy** → EC2 | AWS のマネージドサービスのみで完結。IAM ロールで認証し、SSH 不要 |
| **3-B** | GitHub → **GitHub Actions** → SSH + rsync → EC2 | 構成がシンプル。SSH 鍵を GitHub に登録する必要がある |

---

## 共通の事前準備

### 1. GitHub リポジトリを作成して push

```bash
git init
git add .
# シェルスクリプトに実行権限を付ける（Windows で作業した場合は必須）
git update-index --add --chmod=+x deploy/scripts/*.sh deploy/codedeploy/*.sh
git commit -m "初回コミット"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

### 2. デプロイ先の EC2 と RDS を用意

次のどちらかで用意します。

- **方式1 の CloudFormation スタックを再利用**（パラメータ `InstallCodeDeployAgent=true` で作成）
- **方式2 で構築した EC2 + RDS を再利用**

どちらの場合も、`/etc/aws-training/app.env` の `DEPLOY_METHOD` を変更しておくと、ダッシュボードで方式を確認できます。

```bash
# 3-A の場合
sudo sed -i 's/^DEPLOY_METHOD=.*/DEPLOY_METHOD=cicd-codepipeline/' /etc/aws-training/app.env
# 3-B の場合
sudo sed -i 's/^DEPLOY_METHOD=.*/DEPLOY_METHOD=cicd-github-actions/' /etc/aws-training/app.env
```

---

## 3-A: CodePipeline + CodeBuild + CodeDeploy

```
 GitHub ──push──▶ CodePipeline
                   ├─ Source : GitHub（GitHub App 接続）
                   ├─ Build  : CodeBuild（buildspec.yml: npm ci・構文チェック・実行権限付与）
                   └─ Deploy : CodeDeploy（appspec.yml）──▶ EC2 上の CodeDeploy エージェント
                                                              ├─ BeforeInstall  : before-install.sh
                                                              ├─ (ファイル展開 → /opt/aws-training-release)
                                                              ├─ AfterInstall   : after-install.sh（install-app.sh を実行）
                                                              └─ ValidateService: validate-service.sh（/health 確認）
```

### STEP1: EC2 に IAM ロールと CodeDeploy エージェントを設定

> 方式1 のスタックを `InstallCodeDeployAgent=true` で作成した場合、この STEP は不要です。

1. IAM コンソール →「ロールを作成」→ 信頼されたエンティティ: **EC2**
   - ポリシー: `AmazonSSMManagedInstanceCore`、`AmazonEC2RoleforAWSCodeDeploy`
   - ロール名: `training-ec2-codedeploy-role`
2. EC2 コンソール → 対象インスタンス →「アクション」→「セキュリティ」→「IAM ロールを変更」→ 上記ロールを設定
3. EC2 に SSH 接続し、エージェントをインストール

   ```bash
   cd ~/aws-training-src
   sudo bash deploy/scripts/install-codedeploy-agent.sh
   sudo systemctl status codedeploy-agent
   ```

   > IAM ロールをエージェント起動後に付けた場合は `sudo systemctl restart codedeploy-agent` を実行してください。

4. EC2 インスタンスにタグを付ける: キー `Project` / 値 `aws-training`
   （CloudFormation で作成した場合は付与済み）

### STEP2: CodeDeploy の設定

1. IAM で CodeDeploy 用のサービスロールを作成
   - 信頼されたエンティティ: **CodeDeploy**（ユースケース「CodeDeploy」）
   - ポリシー: `AWSCodeDeployRole`（自動で選択されます）
   - ロール名: `training-codedeploy-service-role`
2. CodeDeploy コンソール →「アプリケーション」→「アプリケーションの作成」
   - アプリケーション名: `aws-training-app` / コンピューティングプラットフォーム: **EC2/オンプレミス**
3. 「デプロイグループの作成」

   | 項目 | 設定 |
   |---|---|
   | デプロイグループ名 | `aws-training-dg` |
   | サービスロール | `training-codedeploy-service-role` |
   | デプロイタイプ | インプレース |
   | 環境設定 | Amazon EC2 インスタンス / タグ `Project` = `aws-training` |
   | エージェント設定 | 「今すぐ更新し、14日ごとに更新をスケジュール」でも「なし」でも可 |
   | デプロイ設定 | `CodeDeployDefault.AllAtOnce` |
   | ロードバランサー | 無効（チェックを外す） |

### STEP3: CodePipeline の作成

CodePipeline コンソール →「パイプラインを作成する」→「カスタムパイプラインを構築する」

1. **パイプライン設定**: 名前 `aws-training-pipeline`、新しいサービスロール
2. **ソースステージ**
   - ソースプロバイダー: **GitHub (GitHub アプリ経由)**
   - 「GitHub に接続する」で接続を作成（GitHub 側で AWS Connector アプリのインストールを許可）
   - リポジトリ名・ブランチ `main` を選択 / トリガー: プッシュ時
3. **ビルドステージ**
   - プロバイダー: **AWS CodeBuild** →「プロジェクトを作成する」
     - プロジェクト名: `aws-training-build`
     - 環境イメージ: マネージド型 / Amazon Linux / Standard ランタイム / 最新イメージ
     - サービスロール: 新しいサービスロール
     - Buildspec: 「buildspec ファイルを使用する」（リポジトリ直下の `buildspec.yml`）
4. **デプロイステージ**
   - プロバイダー: **AWS CodeDeploy**
   - アプリケーション名 `aws-training-app` / デプロイグループ `aws-training-dg`
5. 「パイプラインを作成する」→ 自動で初回実行が始まります

### STEP4: 動作確認

1. パイプラインの 3 ステージ（Source / Build / Deploy）がすべて「成功」になることを確認
2. ブラウザでダッシュボードを開き、デプロイ方式が **方式3: CI/CD（CodePipeline + CodeDeploy）** になっていることを確認
3. コードを変更して push し、自動でデプロイされることを確認

   ```bash
   # 例: バージョンを上げる（ダッシュボードの「アプリバージョン」に反映される）
   npm version patch --no-git-tag-version
   git commit -am "バージョンアップ"
   git push
   ```

### トラブルシューティング（3-A）

| 症状 | 確認箇所 |
|---|---|
| Deploy で「インスタンスが見つからない」 | EC2 のタグ、デプロイグループのタグ条件 |
| Deploy が「Pending」のまま進まない | `sudo systemctl status codedeploy-agent`、EC2 の IAM ロール |
| フックスクリプトの失敗 | CodeDeploy コンソールの「イベント」→ ログ、または EC2 の `/opt/codedeploy-agent/deployment-root/deployment-logs/codedeploy-agent-deployments.log` |
| エージェント自体のエラー | `/var/log/aws/codedeploy-agent/codedeploy-agent.log` |
| Build の失敗 | CodeBuild のビルドログ |
| `Permission denied` でスクリプトが実行できない | 実行権限（共通の事前準備 1 の `git update-index --chmod=+x`）。CodeBuild でも付与しています |

---

## 3-B: GitHub Actions（SSH デプロイ）

ワークフロー定義: [`.github/workflows/deploy-ec2.yml`](../.github/workflows/deploy-ec2.yml)

```
 GitHub ──push──▶ GitHub Actions
                   ├─ test  : npm ci・構文チェック
                   └─ deploy: rsync でソースを EC2 の /tmp/aws-training-release に転送
                              → ssh で install-app.sh を実行 → 外部から /health を確認
```

### STEP1: EC2 側の準備

- EC2 のセキュリティグループで **SSH(22)** を許可します。GitHub のホストランナーの IP は固定ではないため、
  研修中は `0.0.0.0/0` を一時的に許可し、**研修後は必ず閉じてください**。
- EC2 に `rsync` がインストールされていること（`install-packages.sh` でインストール済み）

### STEP2: GitHub リポジトリの設定

リポジトリの「Settings」→「Secrets and variables」→「Actions」

| 種類 | 名前 | 値 |
|---|---|---|
| Secrets | `EC2_HOST` | EC2 のパブリック DNS（または IP） |
| Secrets | `EC2_USER` | `ec2-user` |
| Secrets | `EC2_SSH_KEY` | キーペアの秘密鍵（`.pem` ファイルの中身をすべて貼り付け） |
| Variables | `DEPLOY_TARGET` | `github-actions` |

> `DEPLOY_TARGET` が未設定の場合は test ジョブのみ実行され、デプロイはスキップされます
> （3-A と同じリポジトリを使っても二重デプロイにならないようにするため）。

### STEP3: 動作確認

1. コードを変更して `main` に push（または「Actions」タブ →「Deploy to EC2」→「Run workflow」）
2. 「Actions」タブで test → deploy が成功することを確認
3. ダッシュボードのデプロイ方式が **方式3: CI/CD（GitHub Actions）** になっていることを確認

### トラブルシューティング（3-B）

| 症状 | 原因と対処 |
|---|---|
| `ssh-keyscan` / `rsync` がタイムアウト | セキュリティグループで 22 番が開いていない |
| `Permission denied (publickey)` | `EC2_SSH_KEY` の内容（先頭・末尾の行を含めて貼り付けたか）、`EC2_USER` |
| `install-app.sh` でエラー | EC2 で `sudo journalctl -u aws-training -n 50` |

### 発展課題

- SSH を使わずに、**GitHub OIDC + IAM ロール** で認証し、`aws deploy create-deployment`（CodeDeploy）や
  `aws ssm send-command`（Systems Manager）でデプロイする方式に変更してみましょう（22 番を開ける必要がなくなります）。
