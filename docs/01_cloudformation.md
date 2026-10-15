# 方式1: AWS CloudFormation による一括デプロイ

テンプレート 1 つで、ネットワークからアプリの起動までをすべて自動で構築します。
「インフラをコードで管理する（IaC）」ことのメリットを体験するのが目的です。

## 作成されるリソース

| 種類 | リソース | 補足 |
|---|---|---|
| ネットワーク | VPC (10.0.0.0/16)、パブリックサブネット ×2、プライベートサブネット ×2、IGW、ルートテーブル | RDS はインターネットから到達できないプライベートサブネットに配置 |
| セキュリティグループ | web-sg（80 を公開 / キーペア指定時のみ 22）、db-sg（5432 を web-sg からのみ許可） | |
| Secrets Manager | RDS マスターユーザー、アプリの初期管理者 | パスワードは自動生成。テンプレートやパラメータに平文で書かない |
| RDS | PostgreSQL（db.t4g.micro / 20GB gp3 / 暗号化） | シングル AZ |
| IAM | EC2 用ロール | Session Manager 接続 + 上記シークレットの読み取り |
| EC2 | Amazon Linux 2023（t3.micro） | UserData で Node.js・nginx のインストール〜アプリ起動まで自動実行 |

UserData の処理の流れ:

1. Git リポジトリからソースを `git clone`
2. `deploy/scripts/install-packages.sh` で Node.js 22 / nginx / psql をインストール
3. Secrets Manager から DB・管理者のパスワードを取得し `/etc/aws-training/app.env` を作成
4. `deploy/scripts/install-app.sh` で npm ci → DB 初期化 → systemd / nginx 起動 → ヘルスチェック
5. `cfn-signal` で CloudFormation に完了を通知（失敗時はスタックがロールバック）

## 事前準備

1. このリポジトリを **GitHub の公開リポジトリ** に push しておく（EC2 が `git clone` するため）
2. （任意）SSH で接続したい場合は EC2 キーペアを作成しておく。未指定でも Session Manager で接続できます

## 手順（マネジメントコンソール）

1. CloudFormation コンソール →「スタックの作成」→「新しいリソースを使用（標準）」
2. 「テンプレートファイルのアップロード」で `deploy/cloudformation/template.yaml` を選択
3. スタック名: `aws-training`（任意）
4. パラメータを入力

   | パラメータ | 入力例 |
   |---|---|
   | ProjectName | `aws-training` |
   | GitRepoUrl | `https://github.com/<ユーザー名>/<リポジトリ名>.git` |
   | GitBranch | `main` |
   | KeyName | 空欄（SSH を使う場合はキーペア名） |
   | InstallCodeDeployAgent | `false`（方式3-A でこの環境を再利用する場合は `true`） |
   | その他 | 既定値のままで OK |

5. 「スタックの失敗オプション」で **「正常にプロビジョニングされたリソースを保持する」** を選ぶと、失敗時に EC2 に入って原因を調査できます（研修ではこちらを推奨）
6. 「AWS CloudFormation によって IAM リソースが作成される場合があることを承認します」にチェック →「送信」
7. ステータスが `CREATE_COMPLETE` になるまで待つ（**約 15〜20 分**。RDS の作成に時間がかかります）

## 手順（AWS CLI の場合）

> **Windows の場合**: テンプレートに日本語が含まれるため、事前に `AWS_CLI_FILE_ENCODING=UTF-8` を設定してください
> （未設定だと `text contents could not be decoded` エラーになります）。
> PowerShell: `$env:AWS_CLI_FILE_ENCODING = "UTF-8"` / Git Bash: `export AWS_CLI_FILE_ENCODING=UTF-8`

```bash
aws cloudformation deploy \
  --stack-name aws-training \
  --template-file deploy/cloudformation/template.yaml \
  --parameter-overrides GitRepoUrl=https://github.com/<ユーザー名>/<リポジトリ名>.git \
  --capabilities CAPABILITY_IAM \
  --region ap-northeast-1

aws cloudformation describe-stacks --stack-name aws-training --query "Stacks[0].Outputs" --output table
```

## 動作確認

1. スタックの「出力」タブを開く
2. `AdminSecretConsoleUrl` のリンク → 「シークレットの値を取得する」で初期管理者の `username` / `password` を確認
3. `AppUrl` をブラウザで開き、上記アカウントでログイン
4. ダッシュボードの「現在のデプロイ方式」が **方式1: AWS CloudFormation による一括デプロイ** と表示され、
   RDS 接続状態が「接続OK」になっていることを確認

## EC2 への接続とログ確認

```bash
# Session Manager（キーペア不要）
aws ssm start-session --target <WebServerInstanceId> --region ap-northeast-1
```

| 確認内容 | コマンド |
|---|---|
| セットアップログ | `sudo cat /var/log/aws-training-setup.log` |
| cloud-init のログ | `sudo tail -n 100 /var/log/cloud-init-output.log` |
| アプリのログ | `sudo journalctl -u aws-training -f` |
| nginx のログ | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |
| RDS に接続 | `sudo bash -c 'set -a; . /etc/aws-training/app.env; PGPASSWORD=$DB_PASSWORD psql "host=$DB_HOST user=$DB_USER dbname=$DB_NAME sslmode=require"'` |

## よくあるエラー

| 症状 | 原因と対処 |
|---|---|
| `WebServer` が `CREATE_FAILED`（Received FAILURE signal） | セットアップスクリプトでエラー。上記のセットアップログを確認 |
| `WebServer` がタイムアウト | Git URL の誤り・非公開リポジトリなど。cloud-init のログを確認 |
| ダッシュボードで DB 接続エラー | セキュリティグループ、`/etc/aws-training/app.env` の内容を確認 |

## 後片付け

CloudFormation コンソールでスタックを削除すると、作成したリソースがすべて削除されます
（RDS はスナップショットを残さず削除する設定です）。
