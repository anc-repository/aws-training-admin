'use strict';

const path = require('path');

// ローカル開発用に .env を読み込む（EC2 では systemd の EnvironmentFile で注入される）
//   ENV_FILE を指定すると任意の環境変数ファイルを読み込める（例: ENV_FILE=/etc/aws-training/app.env npm run db:init）
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });

const bool = (v, def = false) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const config = {
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
  deployMethod: process.env.DEPLOY_METHOD || 'local',
  autoMigrate: bool(process.env.AUTO_MIGRATE),
  // nginx 等のリバースプロキシ配下で動かす場合は true（X-Forwarded-* を信頼）
  trustProxy: bool(process.env.TRUST_PROXY, true),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'appuser',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aws_training',
    ssl: bool(process.env.DB_SSL),
    sslCa: process.env.DB_SSL_CA || '',
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  },
};

if (config.env === 'production' && config.sessionSecret === 'dev-only-secret') {
  console.warn('[警告] SESSION_SECRET が未設定です。本番環境では必ず設定してください。');
}

module.exports = config;
