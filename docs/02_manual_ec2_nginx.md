# 方式2: EC2 + nginx 手動デプロイ（DB 手動作成 → RDS へ自動移行）

自分の手でサーバーを構築し、コードをアップロードして nginx で公開します。
DB は **まず EC2 上に手動で PostgreSQL を作成** してアプリを動かし、その後 **RDS を作成してデータを自動移行** します。
CloudFormation や CI/CD が裏側で何をしているのかを理解するのが目的です。

```
STEP1 EC2 を作成 ─▶ STEP2 コードをアップロード ─▶ STEP3 ミドルウェア導入
   ─▶ STEP4 EC2 上に DB を手動作成 ─▶ STEP5 アプリ起動（nginx + systemd）
   ─▶ STEP6 RDS を作成 ─▶ STEP7 データを RDS へ自動移行 ─▶ STEP8 接続先を RDS に切り替え
```

---

## STEP1: セキュリティグループと EC2 の作成

### 1-1. セキュリティグループ（EC2 コンソール →「セキュリティグループ」）

| 名前 | インバウンドルール |
|---|---|
| `training-web-sg` | SSH(22): マイIP / HTTP(80): 0.0.0.0/0 |
| `training-db-sg` | PostgreSQL(5432): ソース = `training-web-sg` |

### 1-2. EC2 インスタンスの起動

| 項目 | 設定 |
|---|---|
| 名前 | `training-web` |
| AMI | Amazon Linux 2023 |
| インスタンスタイプ | t3.micro |
| キーペア | 新規作成（`training-key.pem` をダウンロード） |
| ネットワーク | デフォルト VPC / パブリック IP 自動割り当て: 有効 |
| セキュリティグループ | `training-web-sg` |

起動後、パブリック IPv4 DNS（例: `ec2-xx-xx-xx-xx.ap-northeast-1.compute.amazonaws.com`）を控えておきます。

---

## STEP2: コードを EC2 にアップロード

ローカル PC（このリポジトリのフォルダ）で実行します。Windows の場合は PowerShell で実行できます。

```bash
# node_modules・.git・.env を除いて圧縮
tar --exclude=node_modules --exclude=.git --exclude=.env -czf aws-training.tar.gz .

# EC2 へ転送
scp -i training-key.pem aws-training.tar.gz ec2-user@<EC2のパブリックDNS>:/home/ec2-user/

# EC2 に SSH 接続
ssh -i training-key.pem ec2-user@<EC2のパブリックDNS>
```

> Windows で「UNPROTECTED PRIVATE KEY FILE」と出る場合は、`.pem` のプロパティ → セキュリティで自分以外のアクセス権を削除してください。

EC2 上で展開します。

```bash
mkdir -p ~/aws-training-src && tar -xzf ~/aws-training.tar.gz -C ~/aws-training-src
cd ~/aws-training-src
```

---

## STEP3: ミドルウェアのインストール

スクリプトでまとめて実行できます（中身を読んで、何をしているか確認しましょう）。

```bash
sudo bash deploy/scripts/install-packages.sh
```

スクリプトが行っていること:

```bash
sudo dnf -y update
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -   # Node.js 22 のリポジトリ追加
sudo dnf install -y nodejs nginx git rsync jq openssl postgresql16         # Node.js / nginx / psql クライアント
sudo useradd --system --no-create-home --shell /sbin/nologin nodeapp   # アプリ実行ユーザー
sudo mkdir -p /etc/aws-training /opt/aws-training
sudo curl -fsSL -o /etc/aws-training/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

---

## STEP4: EC2 上に PostgreSQL を手動で作成

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

---

## STEP5: アプリを起動（systemd + nginx）

### 5-1. 環境変数ファイルを作成

```bash
sudo cp deploy/env/app.env.example /etc/aws-training/app.env
sudo vi /etc/aws-training/app.env
```

この時点ではローカル DB を指定します。

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

### 5-2. デプロイスクリプトを実行

```bash
sudo bash deploy/scripts/install-app.sh
```

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

### 5-3. ブラウザで確認

`http://<EC2のパブリックDNS>/` を開いてログインします。
ダッシュボードの DB 接続先が `127.0.0.1` になっていることを確認し、**社員を何件か登録** してください（次の STEP で RDS へ移行されることを確認するため）。

---

## STEP6: RDS for PostgreSQL の作成

RDS コンソール →「データベースの作成」

| 項目 | 設定 |
|---|---|
| 作成方法 | 標準作成 |
| エンジン | PostgreSQL 16 |
| テンプレート | 無料利用枠 |
| DB インスタンス識別子 | `training-db` |
| マスターユーザー名 | `dbadmin` |
| 認証情報の管理 | セルフマネージド（パスワードを自分で入力。`$` `"` `@` `/` 空白は使わない） |
| インスタンスクラス | db.t4g.micro |
| ストレージ | gp3 / 20GB |
| 接続 | 「EC2 コンピューティングリソースに接続しない」/ デフォルト VPC |
| パブリックアクセス | **なし** |
| VPC セキュリティグループ | `training-db-sg`（default は外す） |
| 追加設定 → 最初のデータベース名 | `aws_training`（空欄でも移行スクリプトが作成します） |

作成完了（ステータス「利用可能」）まで約 10 分待ち、**エンドポイント** を控えます。

EC2 から接続できることを確認します。

```bash
PGPASSWORD='<RDSのパスワード>' psql "host=<RDSエンドポイント> user=dbadmin dbname=postgres sslmode=require" -c 'SELECT version();'
```

> タイムアウトする場合は `training-db-sg` のインバウンドルール（ソースが `training-web-sg` か）を確認してください。

---

## STEP7: ローカル DB → RDS へデータを自動移行

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

---

## STEP8: アプリの接続先を RDS に切り替え

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
- STEP5 で登録した社員データがそのまま表示される

確認できたら、EC2 上のローカル DB は停止して構いません。

```bash
sudo systemctl disable --now postgresql
```

---

## 運用コマンド早見表

| 内容 | コマンド |
|---|---|
| アプリの状態 | `sudo systemctl status aws-training` |
| アプリのログ | `sudo journalctl -u aws-training -f` |
| アプリ再起動 | `sudo systemctl restart aws-training` |
| nginx 設定テスト / 再読込 | `sudo nginx -t && sudo systemctl reload nginx` |
| nginx のログ | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |
| コードを更新して再デプロイ | STEP2 で再アップロード → `sudo bash deploy/scripts/install-app.sh` |

## よくあるエラー

| 症状 | 原因と対処 |
|---|---|
| ブラウザで開けない | `training-web-sg` で 80 番が開いているか、`sudo systemctl status nginx` |
| 502 Bad Gateway | Node.js が起動していない。`sudo journalctl -u aws-training -n 50` |
| DB 接続エラー（timeout） | RDS のセキュリティグループ、エンドポイントの誤り |
| `no pg_hba.conf entry ... no encryption` | RDS は SSL 必須。`DB_SSL=true` を設定 |
| `password authentication failed` | `app.env` のユーザー名・パスワードを確認 |
