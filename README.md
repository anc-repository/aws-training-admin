# AWS 研修管理システム

AWS へのデプロイ研修用の、シンプルな管理システム（Node.js + Express + PostgreSQL）です。
同じアプリケーションを **3 種類の方法** で AWS にデプロイし、それぞれの手順・仕組みの違いを体験することを目的としています。

| 方式 | 内容 | 手順書 |
|---|---|---|
| 方式1 | **AWS CloudFormation** で VPC・RDS・EC2 を一括構築し、アプリも自動デプロイ | [docs/01_cloudformation.md](docs/01_cloudformation.md) |
| 方式2 | **EC2 に手動でコードをアップロード**し nginx で公開。DB はまず手動で作成し、その後 **RDS へ自動移行** | [docs/02_manual_ec2_nginx.md](docs/02_manual_ec2_nginx.md) |
| 方式3 | **Git リポジトリからの CI/CD**（A: CodePipeline + CodeBuild + CodeDeploy / B: GitHub Actions） | [docs/03_cicd.md](docs/03_cicd.md) |

ダッシュボードには「現在のデプロイ方式」「EC2 インスタンス ID / AZ」「RDS 接続状態」が表示されるため、どの方式でデプロイされたかを画面で確認できます。

## ログイン情報

初期管理者アカウントは `npm run db:init`（またはデプロイスクリプト）の初回実行時に自動作成されます。

| 環境 | ユーザー名 | パスワード |
|---|---|---|
| ローカル開発 | `admin` | `Admin@12345`（`.env` の `ADMIN_USERNAME` / `ADMIN_PASSWORD`） |
| 方式1: CloudFormation | `admin` | **自動生成**。スタックの出力 `AdminSecretConsoleUrl` → Secrets Manager の「シークレットの値を取得する」で確認（下記コマンドでも可） |
| 方式2・3: EC2 手動 / CI/CD | `/etc/aws-training/app.env` の `ADMIN_USERNAME`（既定 `admin`） | `app.env` の `ADMIN_PASSWORD` に設定した値（空欄の場合は `Admin@12345`） |

方式1 のパスワードを AWS CLI で確認する場合:

```bash
SECRET_ID=$(aws cloudformation describe-stack-resource --stack-name aws-training --logical-resource-id AppAdminSecret \
  --query "StackResourceDetail.PhysicalResourceId" --output text --region <リージョン>)
aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text --region <リージョン>
# 出力例: {"username":"admin","password":"xxxxxxxxxxxxxxxx"}
```

> **注意**
> - 初期管理者は **DB に未作成の場合のみ** 作成されます。作成後に `ADMIN_PASSWORD` を変更しても反映されないため、パスワード変更は画面の「ユーザー管理」から行ってください。
> - `Admin@12345` は研修・開発用の既定値です。インターネットに公開する環境では必ず変更してください。
> - このリポジトリは公開されています。**実際に使用しているパスワードをこのファイルやリポジトリに書かないでください。**
> - 受講者用のアカウントは、管理者でログイン後「ユーザー管理」から追加できます。

## 画面・機能

- **ログイン画面** … アカウントは RDS（PostgreSQL）の `users` テーブルに保存（パスワードは bcrypt ハッシュ）
- **ダッシュボード** … デプロイ方式、サーバー情報（EC2 メタデータ）、DB 接続状態、社員統計、ログイン履歴
- **社員管理** … 一覧・検索・新規登録・編集・削除
- **ユーザー管理**（管理者のみ） … ログインユーザーの追加・パスワード変更・削除
- **ヘルスチェック** … `GET /health`（DB 接続も確認。CodeDeploy / ALB 用）

## 構成

```
  ブラウザ ── HTTPS ─▶ CloudFront（方式1。方式2・3 は任意で追加）
                         │ HTTP:80
                    ┌────┼─────────── VPC ────────────────────────────┐
                    │    ▼  EC2 (Amazon Linux 2023)                    │
                    │   nginx :80 ─▶ Node.js :3000 (systemd)          │
                    │                    │ 5432 (SSL)                 │
                    │                    ▼                            │
                    │   RDS for PostgreSQL（プライベートサブネット）  │
                    └─────────────────────────────────────────────────┘
```

| 項目 | 内容 |
|---|---|
| アプリ | Node.js 22 / Express 4 / EJS |
| DB | PostgreSQL 16（RDS for PostgreSQL） |
| セッション | `connect-pg-simple`（RDS の `session` テーブルに保存） |
| HTTPS | CloudFront（既定の証明書。独自ドメイン不要） |
| Web サーバー | nginx（リバースプロキシ・静的ファイル配信） |
| プロセス管理 | systemd（`aws-training.service`） |
| OS | Amazon Linux 2023 |

## ディレクトリ構成

```
.
├── src/                    アプリケーション本体
│   ├── server.js           起動エントリーポイント
│   ├── app.js              Express 設定
│   ├── config.js           環境変数の読み込み
│   ├── db.js               PostgreSQL 接続プール
│   ├── migrate.js          DB 作成・テーブル作成・初期データ投入
│   ├── middleware/auth.js  ログイン必須・管理者権限・CSRF 対策
│   └── routes/             画面ごとの処理
├── views/                  画面テンプレート（EJS）
├── public/                 CSS / JS
├── db/
│   ├── schema.sql          テーブル定義
│   └── seed.sql            サンプル社員データ
├── scripts/init-db.js      DB 初期化コマンド（npm run db:init）
├── deploy/
│   ├── cloudformation/template.yaml   方式1: CloudFormation テンプレート
│   ├── nginx/                         nginx 設定
│   ├── systemd/aws-training.service   systemd ユニット
│   ├── env/app.env.example            EC2 用 環境変数ファイルの雛形
│   ├── scripts/                       EC2 セットアップ・デプロイ・RDS 移行スクリプト
│   └── codedeploy/                    方式3-A: CodeDeploy フックスクリプト
├── appspec.yml             方式3-A: CodeDeploy 定義
├── buildspec.yml           方式3-A: CodeBuild 定義
├── .github/workflows/      方式3-B: GitHub Actions
├── docker-compose.yml      ローカル開発用 PostgreSQL
└── docs/                   研修手順書
```

## ローカルでの起動

前提: Node.js 20 以上、Docker

```bash
# 1. PostgreSQL を起動（ホストの 5432 番が使用中なら PG_PORT=15432 を付け、.env の DB_PORT も 15432 に）
docker compose up -d

# 2. 環境変数ファイルを作成
cp .env.example .env

# 3. 依存パッケージのインストールと DB 初期化
npm install
npm run db:init

# 4. 起動 → http://localhost:3000
npm run dev
```

初期アカウント: `admin` / `Admin@12345`（`.env` の `ADMIN_USERNAME` / `ADMIN_PASSWORD` で変更可能）

## 環境変数

| 変数名 | 説明 | 例 |
|---|---|---|
| `PORT` | アプリの待ち受けポート | `3000` |
| `NODE_ENV` | 実行環境 | `production` |
| `SESSION_SECRET` | セッション署名用の秘密鍵 | `openssl rand -hex 32` の結果 |
| `DEPLOY_METHOD` | ダッシュボードに表示するデプロイ方式 | `cloudformation` / `manual-ec2` / `cicd-codepipeline` / `cicd-github-actions` / `local` |
| `DB_HOST` / `DB_PORT` | RDS エンドポイント / ポート | `xxx.rds.amazonaws.com` / `5432` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | DB 接続情報 | `dbadmin` / - / `aws_training` |
| `DB_SSL` | SSL 接続（RDS for PostgreSQL 15 以降は必須） | `true` |
| `DB_SSL_CA` | RDS の CA 証明書バンドル（指定時は証明書を検証） | `/etc/aws-training/rds-ca.pem` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初期管理者（`db:init` 実行時に未作成なら作成） | `admin` / - |
| `AUTO_MIGRATE` | 起動時に DB 初期化を自動実行 | `false` |
| `ENV_FILE` | 読み込む環境変数ファイルのパス（既定は `.env`） | `/etc/aws-training/app.env` |

## 研修後の後片付け（課金防止）

- 方式1: CloudFormation スタックを削除（RDS・EC2・VPC がまとめて削除されます）
- 方式2・3: EC2 インスタンス、RDS インスタンス、（作成した場合は）CodePipeline / CodeBuild / CodeDeploy / S3 アーティファクトバケットを削除
- RDS はスナップショットが残っていると課金が続くため、不要なスナップショットも削除してください
