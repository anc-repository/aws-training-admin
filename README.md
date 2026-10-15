# AWS 研修管理システム

AWS へのデプロイ研修用の、シンプルな管理システム（Node.js + Express + PostgreSQL）です。
同じアプリケーションを **3 種類の方法** で AWS にデプロイし、それぞれの手順・仕組みの違いを体験することを目的としています。

| 方式 | 内容 | 所要時間の目安 | 手順 |
|---|---|---|---|
| 方式1 | **AWS CloudFormation** で CloudFront・VPC・RDS・EC2 を一括構築し、アプリも自動デプロイ | 30 分 | [方式1](#方式1-aws-cloudformation-による一括デプロイ) |
| 方式2 | **EC2 に手動でコードをアップロード**し nginx で公開。DB はまず手動で作成し、その後 **RDS へ自動移行** | 2〜3 時間 | [方式2](#方式2-ec2--nginx-手動デプロイdb-手動作成--rds-へ自動移行) |
| 方式3 | **Git リポジトリからの CI/CD**（A: CodePipeline + CodeBuild + CodeDeploy / B: GitHub Actions） | 1〜2 時間 | [方式3](#方式3-git-リポジトリからの-cicd-デプロイ) |

ダッシュボードには「現在のデプロイ方式」「EC2 インスタンス ID / AZ」「RDS 接続状態」が表示されるため、どの方式でデプロイされたかを画面で確認できます。

## 目次

- [ログイン情報](#ログイン情報)
- [画面・機能](#画面機能) / [構成](#構成) / [ディレクトリ構成](#ディレクトリ構成)
- [ローカルでの起動](#ローカルでの起動)
- [デプロイ前の共通準備](#デプロイ前の共通準備)
- [方式1: AWS CloudFormation による一括デプロイ](#方式1-aws-cloudformation-による一括デプロイ)
- [方式2: EC2 + nginx 手動デプロイ（DB 手動作成 → RDS へ自動移行）](#方式2-ec2--nginx-手動デプロイdb-手動作成--rds-へ自動移行)
- [方式3: Git リポジトリからの CI/CD デプロイ](#方式3-git-リポジトリからの-cicd-デプロイ)
- [研修後の後片付け（課金防止）](#研修後の後片付け課金防止)
- [トラブルシューティング](#トラブルシューティング)
- [環境変数](#環境変数)

---

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

---

## 画面・機能

- **ログイン画面** … アカウントは RDS（PostgreSQL）の `users` テーブルに保存（パスワードは bcrypt ハッシュ）
- **ダッシュボード** … デプロイ方式、サーバー情報（EC2 メタデータ）、DB 接続状態、社員統計、ログイン履歴
- **社員管理** … 一覧・検索・新規登録・編集・削除
- **ユーザー管理**（管理者のみ） … ログインユーザーの追加・パスワード変更・削除
- **ヘルスチェック** … `GET /health`（DB 接続も確認。CodeDeploy / ALB 用）

## 構成

```
  ブラウザ ── HTTPS ─▶ CloudFront（方式1 は自動作成。方式2・3 は任意で追加）
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
└── docker-compose.yml      ローカル開発用 PostgreSQL
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

---

## デプロイ前の共通準備

### 1. AWS マネジメントコンソールにサインイン

1. https://console.aws.amazon.com/ にサインイン
   - 研修では **root ユーザーではなく IAM ユーザー（または IAM Identity Center のユーザー）** を使用してください
2. 画面右上の **リージョン選択** で、作業するリージョンを選ぶ
   - 推奨: **アジアパシフィック (東京) ap-northeast-1**
   - 以降のすべての作業は **同じリージョン** で行います（リージョンが違うと作成したリソースが表示されません）
3. 画面上部の **検索バー** にサービス名（例: `CloudFormation`、`EC2`、`RDS`）を入力すると、各サービスの画面を開けます

### 2. GitHub にリポジトリを用意（方式1・3 で使用）

1. GitHub にサインインし、このリポジトリ
   https://github.com/anc-repository/aws-training-admin を開く
2. 画面右上の **「Fork」** →「Create fork」をクリックし、自分のアカウントにコピーを作成
   - 方式1 だけを行う場合、Fork せずに元のリポジトリ URL をそのまま使っても構いません
   - 方式3（CI/CD）では、自分が push できるリポジトリが必要なため **Fork は必須** です
3. Fork したリポジトリの **「Code」** ボタン → HTTPS の URL（`https://github.com/<ユーザー名>/aws-training-admin.git`）を控える

### 3. ローカル PC の準備（方式2・3 で使用）

- Git、OpenSSH（Windows 10 以降は標準で `ssh` / `scp` が使用可能）
- （任意）AWS CLI v2 … `aws configure` で認証情報を設定
  - **Windows で AWS CLI を使う場合**、テンプレートに日本語が含まれるため事前に文字コードを設定:
    PowerShell: `$env:AWS_CLI_FILE_ENCODING = "UTF-8"` / Git Bash: `export AWS_CLI_FILE_ENCODING=UTF-8`

### 料金の目安

| リソース | 料金の目安（東京リージョン） |
|---|---|
| EC2 t3.micro | 約 0.014 USD / 時間 |
| RDS db.t4g.micro（PostgreSQL） | 約 0.025 USD / 時間 + ストレージ |
| パブリック IPv4 アドレス | 0.005 USD / 時間 |
| CloudFront | 研修程度のアクセスであれば無料利用枠内 |
| Secrets Manager | 1 シークレットあたり 0.40 USD / 月（日割り） |

無料利用枠の対象であれば請求されない場合もありますが、**研修が終わったら必ず [後片付け](#研修後の後片付け課金防止) を行ってください。**

---

## 方式1: AWS CloudFormation による一括デプロイ

テンプレート 1 つで、ネットワークからアプリの起動・HTTPS 化までをすべて自動で構築します。
「インフラをコードで管理する（IaC）」ことのメリットを体験するのが目的です。

### 作成されるリソース

```
 ブラウザ ── HTTPS ─▶ CloudFront（https://xxxx.cloudfront.net）
                         │ HTTP:80（CloudFront からの通信のみ許可）
                         ▼
               EC2: nginx ─▶ Node.js ── 5432(SSL) ─▶ RDS for PostgreSQL（プライベートサブネット）
```

| 種類 | リソース | 補足 |
|---|---|---|
| ネットワーク | VPC (10.0.0.0/16)、パブリックサブネット ×2、プライベートサブネット ×2、IGW、ルートテーブル | RDS はインターネットから到達できないプライベートサブネットに配置 |
| CloudFront | ディストリビューション（既定の証明書で HTTPS、HTTP は HTTPS へリダイレクト） | 独自ドメイン不要。動的ページはキャッシュ無効、`/static/*` のみキャッシュ |
| セキュリティグループ | web-sg（80 は **CloudFront からのみ** 許可 / キーペア指定時のみ 22）、db-sg（5432 を web-sg からのみ許可） | CloudFront の AWS 管理プレフィックスリストを使用 |
| Secrets Manager | RDS マスターユーザー、アプリの初期管理者 | パスワードは自動生成。テンプレートやパラメータに平文で書かない |
| RDS | PostgreSQL（db.t4g.micro / 20GB gp3 / 暗号化） | シングル AZ |
| IAM | EC2 用ロール | Session Manager 接続 + 上記シークレットの読み取り |
| EC2 | Amazon Linux 2023（t3.micro） | UserData で Node.js・nginx のインストール〜アプリ起動まで自動実行 |

EC2 の UserData（起動時スクリプト）の処理の流れ:

1. Git リポジトリからソースを `git clone`
2. `deploy/scripts/install-packages.sh` で Node.js 22 / nginx / psql をインストール
3. Secrets Manager から DB・管理者のパスワードを取得し `/etc/aws-training/app.env` を作成
4. `deploy/scripts/install-app.sh` で npm ci → DB 初期化 → systemd / nginx 起動 → ヘルスチェック
5. `cfn-signal` で CloudFormation に完了を通知

### 手順 1: テンプレートファイルを用意

- このリポジトリの `deploy/cloudformation/template.yaml` をローカル PC に保存します
  - GitHub 上でファイルを開き、右上の **「Download raw file」**（ダウンロードアイコン）でも保存できます

### 手順 2: スタックの作成（マネジメントコンソール）

1. 検索バーで **「CloudFormation」** を開く
2. **「スタックの作成」** →「**新しいリソースを使用 (標準)**」をクリック
3. **「スタックの作成」** 画面
   - 「前提条件 - テンプレートの準備」: **「既存のテンプレートを選択」**
   - 「テンプレートの指定」: **「テンプレートファイルのアップロード」** →「**ファイルの選択**」で `template.yaml` を選択
   - **「次へ」**
4. **「スタックの詳細を指定」** 画面
   - スタック名: `aws-training`
   - パラメータ:

     | パラメータ | 入力値 |
     |---|---|
     | ProjectName（プロジェクト名） | `aws-training`（既定値のまま） |
     | GitRepoUrl（Git リポジトリ URL） | 既定値（このリポジトリ）のまま、または Fork したリポジトリの URL |
     | GitBranch | `main` |
     | InstanceType | `t3.micro` |
     | KeyName | 空欄（SSH を使う場合のみ EC2 のキーペア名を入力） |
     | SshAllowedCidr | KeyName を指定する場合のみ、自分のグローバル IP + `/32` |
     | InstallCodeDeployAgent | `false`（方式3-A でこの環境を再利用する場合は `true`） |
     | DB 関連 | 既定値のまま |

   - **「次へ」**
5. **「スタックオプションの設定」** 画面
   - タグ・アクセス許可: 何も入力しない
   - 「スタックの失敗オプション」→「プロビジョニング失敗時の動作」: **「正常にプロビジョニングされたリソースを保持する」** を選択
     （失敗時に EC2 に入って原因を調査できます。研修ではこちらを推奨）
   - 画面下部の「機能」: **「AWS CloudFormation によって IAM リソースが作成される場合があることを承認します。」にチェック**
   - **「次へ」**
6. **「確認して作成」** 画面で内容を確認し、**「送信」**

### 手順 3: 作成完了を待つ（約 15〜20 分）

1. スタックの詳細画面で **「イベント」** タブを開くと、リソースが順番に作成される様子を確認できます（右上の更新ボタンで最新化）
2. RDS の作成に約 10 分、EC2 のセットアップに約 2 分、CloudFront に約 3〜5 分かかります
3. 画面左上のステータスが **`CREATE_COMPLETE`** になれば完了です

### 手順 4: 動作確認

1. スタックの **「出力」** タブを開く
2. `AdminSecretConsoleUrl` の URL をクリック → Secrets Manager の画面が開く
   → 「シークレットの値」欄の **「シークレットの値を取得する」** をクリックし、`username` / `password` を確認
3. `AppUrl`（`https://xxxx.cloudfront.net/`）をクリックしてログイン
4. ダッシュボードで以下を確認
   - 「現在のデプロイ方式」が **方式1: AWS CloudFormation による一括デプロイ**
   - データベース（RDS）接続状態が **接続OK**、接続先ホストが RDS のエンドポイント
   - サーバー情報にインスタンス ID・アベイラビリティーゾーンが表示されている
5. 「社員管理」で社員を登録・編集してみる

> EC2 のパブリック DNS に直接アクセスしても応答しません（CloudFront 経由のみ許可しているため）。

### 手順 5（任意）: EC2 に接続して中身を確認する

SSH キー不要の **Session Manager** で接続できます。

1. 検索バーで **「EC2」** →左メニュー **「インスタンス」** → `aws-training-web` にチェック
2. 右上の **「接続」** →「**Session Manager**」タブ →「**接続**」
3. ブラウザ上のターミナルで以下を実行

| 確認内容 | コマンド |
|---|---|
| セットアップログ | `sudo cat /var/log/aws-training-setup.log` |
| アプリのログ | `sudo journalctl -u aws-training -n 50` |
| nginx のログ | `sudo tail /var/log/nginx/access.log` |
| 環境変数ファイル | `sudo cat /etc/aws-training/app.env` |
| RDS に接続 | `sudo bash -c 'set -a; . /etc/aws-training/app.env; PGPASSWORD=$DB_PASSWORD psql "host=$DB_HOST user=$DB_USER dbname=$DB_NAME sslmode=require"'` |

### （参考）AWS CLI で作成する場合

```bash
aws cloudformation deploy \
  --stack-name aws-training \
  --template-file deploy/cloudformation/template.yaml \
  --capabilities CAPABILITY_IAM \
  --region ap-northeast-1

aws cloudformation describe-stacks --stack-name aws-training --region ap-northeast-1 \
  --query "Stacks[0].Outputs" --output table
```

### 後片付け（方式1）

1. CloudFormation →「スタック」→ `aws-training` を選択 → 右上の **「削除」** →確認画面で **「削除」**
2. ステータスが `DELETE_COMPLETE` になるまで待つ（約 10〜20 分。CloudFront の無効化と RDS の削除に時間がかかります）
3. RDS はスナップショットを残さず削除する設定です。Secrets Manager のシークレットは 30 日後に完全削除されます

---

## 方式2: EC2 + nginx 手動デプロイ（DB 手動作成 → RDS へ自動移行）

自分の手でサーバーを構築し、コードをアップロードして nginx で公開します。
DB は **まず EC2 上に手動で PostgreSQL を作成** してアプリを動かし、その後 **RDS を作成してデータを自動移行** します。
CloudFormation や CI/CD が裏側で何をしているのかを理解するのが目的です。

```
STEP1 キーペア・SG作成 ─▶ STEP2 EC2 作成 ─▶ STEP3 コードをアップロード ─▶ STEP4 ミドルウェア導入
 ─▶ STEP5 EC2 上に DB を手動作成 ─▶ STEP6 アプリ起動（nginx + systemd）
 ─▶ STEP7 RDS を作成 ─▶ STEP8 データを RDS へ自動移行 ─▶ STEP9 接続先を RDS に切り替え
 ─▶ STEP10（任意）CloudFront で HTTPS 化
```

### STEP1: キーペアとセキュリティグループの作成

#### 1-1. キーペア

1. 検索バーで **「EC2」** →左メニュー「ネットワーク & セキュリティ」→ **「キーペア」**
2. 右上の **「キーペアを作成」**
   - 名前: `training-key`
   - キーペアのタイプ: **RSA**
   - プライベートキーファイル形式: **.pem**
3. **「キーペアを作成」** → `training-key.pem` が自動でダウンロードされる（**再ダウンロード不可。大切に保管**）

#### 1-2. Web サーバー用セキュリティグループ

1. 左メニュー「ネットワーク & セキュリティ」→ **「セキュリティグループ」** →右上の **「セキュリティグループを作成」**
2. 「基本的な詳細」
   - セキュリティグループ名: `training-web-sg`
   - 説明: `training web server`
   - VPC: デフォルト VPC（`(デフォルト)` と表示されているもの）
3. 「インバウンドルール」→ **「ルールを追加」** を 2 回クリックし、次の 2 行を設定

   | タイプ | ソース | 説明 |
   |---|---|---|
   | SSH | **マイ IP** | ssh |
   | HTTP | **Anywhere-IPv4**（0.0.0.0/0） | http |

4. 「アウトバウンドルール」はそのまま → 右下の **「セキュリティグループを作成」**

#### 1-3. DB 用セキュリティグループ

1. 再度 **「セキュリティグループを作成」**
   - セキュリティグループ名: `training-db-sg` / 説明: `training database` / VPC: デフォルト VPC
2. 「インバウンドルール」→ **「ルールを追加」**

   | タイプ | ソース |
   |---|---|
   | PostgreSQL | **カスタム** → 検索欄で `training-web-sg` を選択 |

3. **「セキュリティグループを作成」**

### STEP2: EC2 インスタンスの作成

1. 左メニュー **「インスタンス」** →右上の **「インスタンスを起動」**
2. 各項目を設定

   | 項目 | 設定 |
   |---|---|
   | 名前とタグ → 名前 | `training-web` |
   | アプリケーションおよび OS イメージ | 「クイックスタート」→ **Amazon Linux** → **Amazon Linux 2023 AMI** / アーキテクチャ **64 ビット (x86)** |
   | インスタンスタイプ | **t3.micro** |
   | キーペア (ログイン) | `training-key` |
   | ネットワーク設定 | 右上の **「編集」** をクリック → VPC: デフォルト / サブネット: 優先順位なし / **パブリック IP の自動割り当て: 有効化** / ファイアウォール: **「既存のセキュリティグループを選択する」** → `training-web-sg` |
   | ストレージを設定 | 8 GiB gp3（既定値のまま） |

3. 右側の「概要」で内容を確認し、**「インスタンスを起動」**
4. 「インスタンスを表示」→ `training-web` の **インスタンスの状態** が「実行中」、**ステータスチェック** が「2/2 のチェックに合格しました」になるまで待つ（2〜3 分）
5. `training-web` にチェック → 下部の「詳細」タブで **パブリック IPv4 DNS**（例: `ec2-xx-xx-xx-xx.ap-northeast-1.compute.amazonaws.com`）をコピーして控える

### STEP3: コードを EC2 にアップロード

ローカル PC で実行します（Windows は PowerShell で実行できます）。

```bash
# リポジトリを取得（Fork した場合は自分のリポジトリ URL）
git clone https://github.com/anc-repository/aws-training-admin.git
cd aws-training-admin

# node_modules・.git・.env を除いて圧縮
tar --exclude=node_modules --exclude=.git --exclude=.env -czf aws-training.tar.gz .

# EC2 へ転送（training-key.pem のパスは保存場所に合わせる）
scp -i training-key.pem aws-training.tar.gz ec2-user@<パブリックIPv4 DNS>:/home/ec2-user/

# EC2 に SSH 接続（初回は「Are you sure you want to continue connecting」に yes）
ssh -i training-key.pem ec2-user@<パブリックIPv4 DNS>
```

> Windows で「UNPROTECTED PRIVATE KEY FILE」と表示される場合: `.pem` を右クリック →「プロパティ」→「セキュリティ」→「詳細設定」→
> 「継承の無効化」→「継承されたアクセス許可を…明示的なアクセス許可に変換します」→ 自分以外のユーザーを削除 →「OK」

EC2 上で展開します。

```bash
mkdir -p ~/aws-training-src && tar -xzf ~/aws-training.tar.gz -C ~/aws-training-src
cd ~/aws-training-src
```

### STEP4: ミドルウェアのインストール

スクリプトでまとめて実行できます（中身を読んで、何をしているか確認しましょう）。

```bash
sudo bash deploy/scripts/install-packages.sh
```

スクリプトが行っていること:

```bash
sudo dnf -y update
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -   # Node.js 22 のリポジトリ追加
sudo dnf install -y nodejs nginx git rsync jq openssl postgresql16  # Node.js / nginx / psql クライアント
sudo useradd --system --no-create-home --shell /sbin/nologin nodeapp   # アプリ実行ユーザー
sudo mkdir -p /etc/aws-training /opt/aws-training
sudo curl -fsSL -o /etc/aws-training/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

### STEP5: EC2 上に PostgreSQL を手動で作成

まずは RDS を使わず、EC2 の中に DB サーバーを立てて手作業で DB・ユーザー・テーブルを作ります。

```bash
# PostgreSQL サーバーのインストールと初期化
sudo dnf install -y postgresql16-server
sudo postgresql-setup --initdb

# localhost からのパスワード認証を許可（ident → scram-sha-256）
sudo sed -i -E 's/^(host\s+all\s+all\s+(127\.0\.0\.1\/32|::1\/128)\s+)ident/\1scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf
sudo systemctl enable --now postgresql

# DB ユーザーとデータベースを作成
sudo -u postgres psql <<'SQL'
CREATE USER appuser WITH PASSWORD 'LocalPass123';
CREATE DATABASE aws_training OWNER appuser ENCODING 'UTF8';
SQL

# テーブルを手動で作成して確認
PGPASSWORD=LocalPass123 psql -h 127.0.0.1 -U appuser -d aws_training -f db/schema.sql
PGPASSWORD=LocalPass123 psql -h 127.0.0.1 -U appuser -d aws_training -c '\dt'
```

`\dt` で `employees` / `login_history` / `users` の 3 テーブルが表示されれば成功です。

### STEP6: アプリを起動（systemd + nginx）

#### 6-1. 環境変数ファイルを作成

```bash
sudo cp deploy/env/app.env.example /etc/aws-training/app.env
openssl rand -hex 32          # 表示された文字列を SESSION_SECRET に使う
sudo vi /etc/aws-training/app.env
```

この時点ではローカル DB を指定します（vi は `i` で編集開始、`Esc` → `:wq` で保存）。

```ini
SESSION_SECRET=<openssl rand -hex 32 の結果>
DEPLOY_METHOD=manual-ec2
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=appuser
DB_PASSWORD=LocalPass123
DB_NAME=aws_training
DB_SSL=false
DB_SSL_CA=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<管理画面にログインするパスワード>
```

#### 6-2. デプロイスクリプトを実行

```bash
sudo bash deploy/scripts/install-app.sh
```

最後に `ヘルスチェック OK: {"status":"ok","db":"ok"}` と表示されれば成功です。

スクリプトが行っていること（手で 1 つずつ実行しても OK）:

```bash
sudo rsync -a --delete --exclude node_modules ~/aws-training-src/ /opt/aws-training/   # ソース配置
cd /opt/aws-training && sudo npm ci --omit=dev                                          # 依存パッケージ
sudo cp deploy/nginx/nginx.conf /etc/nginx/nginx.conf                                   # nginx 設定
sudo cp deploy/nginx/aws-training.conf /etc/nginx/conf.d/
sudo cp deploy/systemd/aws-training.service /etc/systemd/system/                        # systemd 設定
sudo ENV_FILE=/etc/aws-training/app.env node scripts/init-db.js                         # 管理者・サンプルデータ投入
sudo systemctl daemon-reload && sudo systemctl enable --now aws-training                # アプリ起動
sudo nginx -t && sudo systemctl restart nginx                                           # nginx 起動
curl http://127.0.0.1/health                                                            # 動作確認
```

#### 6-3. ブラウザで確認

1. ブラウザのアドレスバーに **`http://`** から入力して `http://<パブリックIPv4 DNS>/` を開く
   （`https://` ではアクセスできません。HTTPS 化は STEP10 で行います）
2. `admin` / 6-1 で設定したパスワードでログイン
3. ダッシュボードの DB 接続先が `127.0.0.1` になっていることを確認
4. 「社員管理」→「＋ 新規登録」で **社員を何件か登録** する（次の STEP で RDS へ移行されることを確認するため）

### STEP7: RDS for PostgreSQL の作成

1. 検索バーで **「RDS」** →左メニュー **「データベース」** →右上の **「データベースの作成」**
2. 各項目を設定

   | 項目 | 設定 |
   |---|---|
   | データベース作成方法を選択 | **標準作成** |
   | エンジンのオプション → エンジンタイプ | **PostgreSQL** |
   | エンジンバージョン | **PostgreSQL 16.x**（16 系の最新） |
   | テンプレート | **無料利用枠**（表示されない場合は「サンドボックス」または「開発/テスト」） |
   | 可用性と耐久性 | **シングル AZ DB インスタンスデプロイ**（選択肢がある場合） |
   | 設定 → DB インスタンス識別子 | `training-db` |
   | 認証情報の設定 → マスターユーザー名 | `dbadmin` |
   | 認証情報管理 | **セルフマネージド**（「パスワードの自動生成」のチェックは外す） |
   | マスターパスワード / マスターパスワードを確認 | 任意のパスワード（`$` `"` `@` `/` 空白は使わない）。**控えておく** |
   | インスタンスの設定 | **バースト可能クラス (t クラスを含む)** → **db.t4g.micro** |
   | ストレージ | ストレージタイプ **汎用 SSD (gp3)** / 割り当てられたストレージ **20** GiB |
   | ストレージ → 追加のストレージ設定 | 「ストレージの自動スケーリングを有効にする」の **チェックを外す** |
   | 接続 → コンピューティングリソース | **EC2 コンピューティングリソースに接続しない** |
   | ネットワークタイプ | IPv4 |
   | Virtual Private Cloud (VPC) | デフォルト VPC |
   | DB サブネットグループ | 既定値（default） |
   | パブリックアクセス | **なし** |
   | VPC セキュリティグループ (ファイアウォール) | **既存を選択** → `training-db-sg` を追加し、`default` は **×** で外す |
   | アベイラビリティーゾーン | 指定なし |
   | データベース認証 | パスワード認証 |
   | モニタリング | 既定値のまま |
   | 追加設定 → 最初のデータベース名 | `aws_training`（空欄でも移行スクリプトが作成します） |
   | 追加設定 → 削除保護 | **チェックを外す**（研修後に削除しやすくするため） |

3. 画面下部の「月額料金の見積もり」を確認し、**「データベースの作成」**
   （作成後にアドオンの提案などのダイアログが表示された場合は「閉じる」）
4. データベース一覧で `training-db` の **ステータス** が「作成中」→「**利用可能**」になるまで待つ（約 10 分）
5. `training-db` をクリック →「**接続とセキュリティ**」タブの **エンドポイント**（例: `training-db.xxxxxxxx.ap-northeast-1.rds.amazonaws.com`）を控える

EC2 から RDS に接続できることを確認します。

```bash
PGPASSWORD='<RDSのパスワード>' psql "host=<RDSエンドポイント> user=dbadmin dbname=postgres sslmode=require" -c 'SELECT version();'
```

> タイムアウトする場合は `training-db-sg` のインバウンドルール（ソースが `training-web-sg` か）、
> RDS の「接続とセキュリティ」タブの VPC セキュリティグループを確認してください。

### STEP8: ローカル DB → RDS へデータを自動移行

`pg_dump` で EC2 上の DB を丸ごと取り出し、RDS に流し込みます。件数の比較まで自動で行います。

```bash
cd ~/aws-training-src
export SRC_HOST=127.0.0.1 SRC_USER=appuser SRC_PASSWORD=LocalPass123 SRC_DB=aws_training
export DST_HOST=<RDSエンドポイント> DST_USER=dbadmin DST_PASSWORD='<RDSのパスワード>' DST_DB=aws_training
bash deploy/scripts/migrate-to-rds.sh
```

出力例:

```
=== 移行結果（件数比較）===
  users           移行元:     1 件 / RDS:     1 件 OK
  employees       移行元:    10 件 / RDS:    10 件 OK
  login_history   移行元:     3 件 / RDS:     3 件 OK
```

### STEP9: アプリの接続先を RDS に切り替え

```bash
sudo vi /etc/aws-training/app.env
```

```ini
DB_HOST=<RDSエンドポイント>
DB_USER=dbadmin
DB_PASSWORD=<RDSのパスワード>
DB_SSL=true
DB_SSL_CA=/etc/aws-training/rds-ca.pem
```

```bash
sudo systemctl restart aws-training
curl http://127.0.0.1/health
```

ブラウザで再度ログインし、以下を確認します。

- ダッシュボードの DB 接続先が **RDS のエンドポイント** になっている
- STEP6 で登録した社員データがそのまま表示される

確認できたら、EC2 上のローカル DB は停止して構いません。

```bash
sudo systemctl disable --now postgresql
```

### STEP10（任意）: CloudFront で HTTPS 化

ここまでの構成は HTTP のため、ログインパスワードが暗号化されずに送信されます。
CloudFront を前段に置くと、独自ドメインが無くても `https://xxxx.cloudfront.net` でアクセスできます。

#### 10-1. ディストリビューションの作成

1. 検索バーで **「CloudFront」** →左メニュー **「ディストリビューション」** → **「ディストリビューションを作成」**
   - 料金プランの選択画面が表示された場合は、**無料プラン** または **従量課金** を選択
2. **「ディストリビューション名」**: `training-cdn` → **「単一のウェブサイトまたはアプリ」** → **「次へ」**
3. 「ドメインの設定」: 何も入力せず **「次へ」**
4. **「オリジンを指定」**
   - オリジンタイプ: **その他**（カスタムオリジン）
   - オリジン: EC2 の **パブリック IPv4 DNS** を入力（`http://` は付けない）
   - 設定: **「オリジン設定のカスタマイズ」** を選び、プロトコルを **「HTTP のみ」**（ポート 80）にする
   - **「次へ」**
5. 「セキュリティ保護を有効にする」: **WAF は有効にしない**（研修のため）→ **「次へ」**
6. 内容を確認し **「ディストリビューションを作成」**

#### 10-2. キャッシュ動作（ビヘイビア）の変更

作成したディストリビューションを開き、**「ビヘイビア」** タブ → パスパターン `デフォルト (*)` にチェック → **「編集」**

| 項目 | 設定 |
|---|---|
| ビューワープロトコルポリシー | **Redirect HTTP to HTTPS** |
| 許可された HTTP メソッド | **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** |
| キャッシュキーとオリジンリクエスト | **Cache policy and origin request policy (recommended)** |
| キャッシュポリシー | **CachingDisabled** |
| オリジンリクエストポリシー | **AllViewerAndCloudFrontHeaders-2022-06** |

→ **「変更を保存」**

> POST を許可しないとログインできません。キャッシュを無効にしないと他人の画面が表示される恐れがあります。

#### 10-3. 動作確認と EC2 への直接アクセスの禁止

1. 「一般」タブの **最終変更日時** が「デプロイ中」から日時に変わるまで待つ（5〜10 分）
2. **ディストリビューションドメイン名** を `https://xxxx.cloudfront.net/` の形でブラウザで開き、ログインできることを確認
3. EC2 →「セキュリティグループ」→ `training-web-sg` →「インバウンドルール」タブ →「**インバウンドのルールを編集**」
   - HTTP 行の ソース を **カスタム** にし、検索欄に `cloudfront` と入力 → **`com.amazonaws.global.cloudfront.origin-facing`** を選択
   - 元の `0.0.0.0/0` は削除 → **「ルールを保存」**
4. `http://<パブリックIPv4 DNS>/` では接続できなくなり、CloudFront の URL からのみアクセスできることを確認

> アプリは CloudFront が付与する `CloudFront-Forwarded-Proto` ヘッダーを nginx 経由で受け取り、
> HTTPS の場合のみ Cookie に `Secure` 属性を付けます。ログイン履歴の IP は `CloudFront-Viewer-Address` から取得します。

### 運用コマンド早見表（方式2・3 共通）

| 内容 | コマンド |
|---|---|
| アプリの状態 | `sudo systemctl status aws-training` |
| アプリのログ | `sudo journalctl -u aws-training -f` |
| アプリ再起動 | `sudo systemctl restart aws-training` |
| nginx 設定テスト / 再読込 | `sudo nginx -t && sudo systemctl reload nginx` |
| nginx のログ | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |
| コードを更新して再デプロイ | STEP3 で再アップロード → `sudo bash deploy/scripts/install-app.sh` |

### 後片付け（方式2）

1. CloudFront（作成した場合）: ディストリビューションにチェック → **「無効化」** → ステータスが無効になったら **「削除」**
2. RDS: 「データベース」→ `training-db` にチェック →「アクション」→ **「削除」**
   - 「最終スナップショットを作成」のチェックを外す / 「自動バックアップを保持」のチェックを外す
   - 「インスタンスの削除後、システムスナップショットおよびポイントインタイムリカバリを含む自動バックアップが利用できなくなることを承認します」にチェック
   - `delete me` と入力 →「**削除**」
3. EC2: 「インスタンス」→ `training-web` にチェック →「インスタンスの状態」→ **「インスタンスを終了 (削除)」**
4. セキュリティグループ `training-db-sg` → `training-web-sg` の順に削除（RDS・EC2 の削除完了後）
5. 不要であればキーペア `training-key` も削除

---

## 方式3: Git リポジトリからの CI/CD デプロイ

`git push` するだけで、ビルド → テスト → EC2 へのデプロイが自動で行われる仕組みを作ります。
2 つのパターンを用意しています（どちらか一方を選んで実施してください）。

| パターン | 仕組み | 特徴 |
|---|---|---|
| **3-A**（推奨） | GitHub → **CodePipeline** → **CodeBuild** → **CodeDeploy** → EC2 | AWS のマネージドサービスのみで完結。IAM ロールで認証し、SSH 不要 |
| **3-B** | GitHub → **GitHub Actions** → SSH + rsync → EC2 | 構成がシンプル。SSH 鍵を GitHub に登録する必要がある |

### 共通の事前準備

1. [デプロイ前の共通準備](#デプロイ前の共通準備) の手順 2 で、このリポジトリを **自分のアカウントに Fork** しておく
2. Fork したリポジトリをローカル PC に clone する

   ```bash
   git clone https://github.com/<ユーザー名>/aws-training-admin.git
   cd aws-training-admin
   ```

3. デプロイ先の EC2 と RDS を用意する（次のどちらか）
   - **方式2 で構築した EC2 + RDS を再利用**（STEP9 まで完了していること）
   - **方式1 の CloudFormation スタックを再利用**（パラメータ `InstallCodeDeployAgent` を `true` にして作成）
4. ダッシュボードでデプロイ方式を確認できるよう、EC2 上で `DEPLOY_METHOD` を変更しておく

   ```bash
   # 3-A の場合
   sudo sed -i 's/^DEPLOY_METHOD=.*/DEPLOY_METHOD=cicd-codepipeline/' /etc/aws-training/app.env
   # 3-B の場合
   sudo sed -i 's/^DEPLOY_METHOD=.*/DEPLOY_METHOD=cicd-github-actions/' /etc/aws-training/app.env
   ```

---

### 3-A: CodePipeline + CodeBuild + CodeDeploy

```
 GitHub ──push──▶ CodePipeline
                   ├─ Source : GitHub（GitHub アプリ経由の接続）
                   ├─ Build  : CodeBuild（buildspec.yml: npm ci・構文チェック・実行権限付与）
                   └─ Deploy : CodeDeploy（appspec.yml）──▶ EC2 上の CodeDeploy エージェント
                                                              ├─ BeforeInstall  : before-install.sh
                                                              ├─ (ファイル展開 → /opt/aws-training-release)
                                                              ├─ AfterInstall   : after-install.sh（install-app.sh を実行）
                                                              └─ ValidateService: validate-service.sh（/health 確認）
```

#### STEP1: EC2 用の IAM ロールを作成して EC2 に付ける

> 方式1 のスタックを `InstallCodeDeployAgent=true` で作成した場合、STEP1・STEP2 は不要です。

1. 検索バーで **「IAM」** →左メニュー **「ロール」** →右上の **「ロールを作成」**
2. 「信頼されたエンティティを選択」
   - 信頼されたエンティティタイプ: **AWS のサービス**
   - ユースケース: サービスまたはユースケースで **EC2** を選び、その下の **EC2** を選択 → **「次へ」**
3. 「許可を追加」: 検索欄で次の 2 つを検索してそれぞれ **チェック** → **「次へ」**
   - `AmazonSSMManagedInstanceCore`
   - `AmazonEC2RoleforAWSCodeDeploy`
4. ロール名: `training-ec2-codedeploy-role` → **「ロールを作成」**
5. 検索バーで **「EC2」** →「インスタンス」→ `training-web` にチェック →右上の **「アクション」** →「**セキュリティ**」→「**IAM ロールを変更**」
6. IAM ロール: `training-ec2-codedeploy-role` → **「IAM ロールの更新」**
7. 同じインスタンスの下部 **「タグ」** タブ → **「タグを管理」** → **「新しいタグを追加」**
   - キー: `Project` / 値: `aws-training` → **「保存」**

#### STEP2: EC2 に CodeDeploy エージェントをインストール

EC2 に SSH 接続して実行します。

```bash
cd ~/aws-training-src
sudo bash deploy/scripts/install-codedeploy-agent.sh
sudo systemctl status codedeploy-agent     # active (running) であること
```

> IAM ロールをエージェント起動後に付けた場合は `sudo systemctl restart codedeploy-agent` を実行してください。

#### STEP3: CodeDeploy 用のサービスロールを作成

1. **「IAM」** →「ロール」→ **「ロールを作成」**
2. 信頼されたエンティティタイプ: **AWS のサービス** / サービスまたはユースケース: **CodeDeploy** → ユースケース: **CodeDeploy** → **「次へ」**
3. 「許可を追加」: `AWSCodeDeployRole` が自動で付いていることを確認 → **「次へ」**
4. ロール名: `training-codedeploy-service-role` → **「ロールを作成」**

#### STEP4: CodeDeploy アプリケーションとデプロイグループを作成

1. 検索バーで **「CodeDeploy」** →左メニュー「デプロイ」→ **「アプリケーション」** → **「アプリケーションの作成」**
   - アプリケーション名: `aws-training-app`
   - コンピューティングプラットフォーム: **EC2/オンプレミス**
   - **「アプリケーションの作成」**
2. 作成したアプリケーションの画面で **「デプロイグループ」** タブ → **「デプロイグループの作成」**

   | 項目 | 設定 |
   |---|---|
   | デプロイグループ名 | `aws-training-dg` |
   | サービスロール | `training-codedeploy-service-role` |
   | デプロイタイプ | **インプレース** |
   | 環境設定 | **Amazon EC2 インスタンス** にチェック → キー `Project` / 値 `aws-training`（「一致するインスタンス」が 1 件になること） |
   | AWS Systems Manager を使用したエージェント設定 | **なし**（STEP2 でインストール済みのため） |
   | デプロイ設定 | **CodeDeployDefault.AllAtOnce** |
   | ロードバランサー | **「ロードバランシングを有効にする」のチェックを外す** |

3. **「デプロイグループの作成」**

#### STEP5: CodePipeline の作成

1. 検索バーで **「CodePipeline」** →左メニュー「パイプライン」→ **「パイプラインを作成する」**
2. **ステップ 1「作成オプションを選択する」**: **カスタムパイプラインを構築する** → **「次へ」**
3. **ステップ 2「パイプラインの設定を選択する」**
   - パイプライン名: `aws-training-pipeline`
   - パイプラインのタイプ: **V2**（既定）
   - サービスロール: **New service role**（新しいサービスロール）
   - **「次へ」**
4. **ステップ 3「ソースステージの追加」**
   - ソースプロバイダー: **GitHub (GitHub アプリ経由)**
   - 接続: **「GitHub に接続する」** をクリック → 別ウィンドウで
     1. 接続名: `training-github` → **「GitHub に接続する」**
     2. GitHub の認可画面で **「Authorize AWS Connector for GitHub」**
     3. 「GitHub アプリ」欄で **「新しいアプリをインストールする」** → GitHub 側で自分のアカウントを選び、
        **「Only select repositories」** で `aws-training-admin` を選択 → **「Install」**
     4. AWS の画面に戻り **「接続」**
   - リポジトリ名: `<ユーザー名>/aws-training-admin`
   - デフォルトブランチ: `main`
   - 出力アーティファクト形式: **CodePipeline のデフォルト**
   - トリガー: 既定値（`main` へのプッシュで起動）
   - **「次へ」**
5. **ステップ 4「ビルドステージの追加」**
   - ビルドプロバイダー: **AWS CodeBuild** / リージョン: 作業中のリージョン
   - プロジェクト名: **「プロジェクトを作成する」** をクリック → 別ウィンドウで CodeBuild の作成画面が開く

     | 項目 | 設定 |
     |---|---|
     | プロジェクトの設定 → プロジェクト名 | `aws-training-build` |
     | 環境 → プロビジョニングモデル | **オンデマンド** |
     | 環境イメージ | **マネージドイメージ** |
     | コンピューティング | **EC2** |
     | オペレーティングシステム | **Amazon Linux** |
     | ランタイム | **Standard** |
     | イメージ | `aws/codebuild/amazonlinux-x86_64-standard:5.0`（最新） |
     | サービスロール | **新しいサービスロール** |
     | Buildspec → ビルド仕様 | **buildspec ファイルを使用**（リポジトリ直下の `buildspec.yml` が使われる） |

     → 下部の **「CodePipeline に進む」** で元の画面に戻る

     > 「プロジェクトを作成する」ボタンが無い場合は、別タブで CodeBuild コンソール →「ビルドプロジェクトを作成する」から
     > 上表の内容でプロジェクトを作成し（ソースプロバイダーは GitHub、上で作成した接続を選択）、ここで選択してください。

   - ビルドタイプ: **単一ビルド** → **「次へ」**
6. **ステップ 5「テストステージの追加」**: **「テストステージをスキップ」**
7. **ステップ 6「デプロイステージの追加」**
   - デプロイプロバイダー: **AWS CodeDeploy**
   - アプリケーション名: `aws-training-app` / デプロイグループ: `aws-training-dg`
   - **「次へ」**
8. **ステップ 7「確認」**: 内容を確認し **「パイプラインを作成する」**

作成すると自動で初回実行が始まります。

#### STEP6: 動作確認

1. パイプライン画面で **Source → Build → Deploy** の 3 ステージがすべて **「成功しました」** になることを確認
   - Deploy の「詳細」リンクから CodeDeploy のデプロイ画面を開くと、各ライフサイクルイベント（BeforeInstall / AfterInstall / ValidateService）の結果を確認できます
2. ブラウザでダッシュボードを開き、デプロイ方式が **方式3: CI/CD（CodePipeline + CodeDeploy）** になっていることを確認
3. ローカル PC でコードを変更して push し、自動でデプロイされることを確認

   ```bash
   # 例: バージョンを上げる（ダッシュボードの「アプリバージョン」に反映される）
   npm version patch --no-git-tag-version
   git commit -am "バージョンアップ"
   git push
   ```

#### 後片付け（3-A）

CodePipeline のパイプライン → CodeBuild のビルドプロジェクト → CodeDeploy のアプリケーションの順に、各画面で選択して **「削除」**。
CodePipeline が作成した S3 バケット（`codepipeline-<リージョン>-...`）も、中身を空にしてから削除してください。
「デベロッパー用ツール」→「設定」→「接続」の `training-github` も不要であれば削除します。

---

### 3-B: GitHub Actions（SSH デプロイ）

ワークフロー定義: [`.github/workflows/deploy-ec2.yml`](.github/workflows/deploy-ec2.yml)

```
 GitHub ──push──▶ GitHub Actions
                   ├─ test  : npm ci・構文チェック
                   └─ deploy: rsync でソースを EC2 の /tmp/aws-training-release に転送
                              → ssh で install-app.sh を実行 → 外部から /health を確認
```

#### STEP1: EC2 側の準備

1. EC2 →「セキュリティグループ」→ `training-web-sg` →「インバウンドルール」タブ →「**インバウンドのルールを編集**」
2. SSH 行のソースを **Anywhere-IPv4（0.0.0.0/0）** に変更 →「**ルールを保存**」
   - GitHub のランナーの IP アドレスは固定ではないため、研修中のみ一時的に許可します。**研修後は必ず「マイ IP」に戻してください**
3. EC2 に `rsync` がインストールされていること（`install-packages.sh` でインストール済み）

#### STEP2: GitHub リポジトリの設定

1. GitHub で Fork したリポジトリを開き、**「Settings」** タブ →左メニュー「Secrets and variables」→ **「Actions」**
2. **「Secrets」** タブ → **「New repository secret」** で次の 3 つを登録

   | Name | Secret |
   |---|---|
   | `EC2_HOST` | EC2 のパブリック IPv4 DNS |
   | `EC2_USER` | `ec2-user` |
   | `EC2_SSH_KEY` | `training-key.pem` をテキストエディタで開き、`-----BEGIN` から `-----END ... KEY-----` までをすべて貼り付け |

3. **「Variables」** タブ → **「New repository variable」** で次を登録

   | Name | Value |
   |---|---|
   | `DEPLOY_TARGET` | `github-actions` |
   | `APP_URL`（任意） | CloudFront を使っている場合は `https://xxxx.cloudfront.net/`（デプロイ後のヘルスチェック先。未設定なら `http://EC2_HOST/`） |

   > `DEPLOY_TARGET` が未設定の場合は test ジョブのみ実行され、デプロイはスキップされます
   > （3-A と同じリポジトリを使っても二重デプロイにならないようにするため）。

4. **「Actions」** タブを開き、「Workflows aren't being run on this forked repository」と表示された場合は
   **「I understand my workflows, go ahead and enable them」** をクリック

#### STEP3: 動作確認

1. コードを変更して `main` に push（または **「Actions」** タブ →「Deploy to EC2」→ **「Run workflow」**）
2. 「Actions」タブで **test → deploy** が緑のチェックになることを確認（失敗時はジョブをクリックするとログを確認できます）
3. ダッシュボードのデプロイ方式が **方式3: CI/CD（GitHub Actions）** になっていることを確認

#### 発展課題

- SSH を使わずに、**GitHub OIDC + IAM ロール** で認証し、`aws deploy create-deployment`（CodeDeploy）や
  `aws ssm send-command`（Systems Manager）でデプロイする方式に変更してみましょう（22 番を開ける必要がなくなります）。

---

## 研修後の後片付け（課金防止）

| 方式 | 削除するもの |
|---|---|
| 方式1 | CloudFormation スタック（[手順](#後片付け方式1)） |
| 方式2 | CloudFront → RDS → EC2 → セキュリティグループ → キーペア（[手順](#後片付け方式2)） |
| 方式3-A | CodePipeline / CodeBuild / CodeDeploy / S3 アーティファクトバケット / GitHub 接続（[手順](#後片付け3-a)） + 方式1 または 2 の環境 |
| 方式3-B | GitHub の Secrets・Variables、SG の SSH 許可を元に戻す + 方式1 または 2 の環境 |

- RDS はスナップショットが残っていると課金が続くため、RDS →「スナップショット」に不要なものが残っていないか確認してください
- EC2 →「Elastic IP」に未使用のアドレスが残っていないか確認してください
- 最後に「Billing and Cost Management」→「請求書」で、想定外の課金がないか確認しましょう

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ブラウザで `ERR_CONNECTION_TIMED_OUT` | 方式1: EC2 に直接アクセスしている → 出力の `AppUrl`（CloudFront の URL）を使う。方式2: `https://` で開いている → `http://` から入力する、または STEP10 で HTTPS 化 |
| CloudFront で `502` / `504` | EC2 が停止している、またはアプリが起動していない。EC2 を停止→起動するとパブリック DNS が変わるため、CloudFront のオリジンも更新が必要 |
| 502 Bad Gateway（nginx） | Node.js が起動していない。`sudo journalctl -u aws-training -n 50` |
| CloudFormation で `WebServer` が `CREATE_FAILED` | セットアップスクリプトでエラー。Session Manager で接続し `/var/log/aws-training-setup.log` を確認 |
| CloudFormation で `WebServer` がタイムアウト | Git URL の誤り・非公開リポジトリなど。`/var/log/cloud-init-output.log` を確認 |
| DB 接続エラー（timeout） | RDS のセキュリティグループ、エンドポイントの誤り |
| `no pg_hba.conf entry ... no encryption` | RDS は SSL 必須。`DB_SSL=true` を設定 |
| `password authentication failed` | `app.env` のユーザー名・パスワードを確認 |
| ログインできない（CloudFront 経由） | ビヘイビアで POST が許可されているか、オリジンリクエストポリシーで Cookie が転送されているか |
| CodeDeploy で「インスタンスが見つからない」 | EC2 のタグ、デプロイグループのタグ条件 |
| CodeDeploy が「Pending」のまま進まない | `sudo systemctl status codedeploy-agent`、EC2 の IAM ロール |
| CodeDeploy のフックスクリプトが失敗 | EC2 の `/opt/codedeploy-agent/deployment-root/deployment-logs/codedeploy-agent-deployments.log` |
| GitHub Actions で `ssh-keyscan` / `rsync` がタイムアウト | セキュリティグループで 22 番が開いていない |
| GitHub Actions で `Permission denied (publickey)` | `EC2_SSH_KEY` の内容（先頭・末尾の行を含めて貼り付けたか）、`EC2_USER` |
| Windows の AWS CLI で `text contents could not be decoded` | `AWS_CLI_FILE_ENCODING=UTF-8` を設定 |
| SSH で `UNPROTECTED PRIVATE KEY FILE` | [方式2 STEP3](#step3-コードを-ec2-にアップロード) の注記を参照 |

---

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
| `TRUST_PROXY` | nginx 等のリバースプロキシを信頼するか | `true` |
