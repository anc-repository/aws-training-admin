'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');

const config = require('./config');
const db = require('./db');
const { requireLogin, csrf } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
if (config.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  // HTTP（ALB/HTTPS 未設定）でも研修できるよう、HTTPS への自動昇格は無効化
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  strictTransportSecurity: false,
}));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// ヘルスチェック（ALB / CodeDeploy の ValidateService から利用）
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'ng', db: err.code || 'error' });
  }
});

// セッションは RDS 上の session テーブルに保存（複数台構成でもログイン状態を共有できる）
app.use(session({
  name: 'aws_training_sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
  // secure: 'auto' … HTTPS（CloudFront 経由）でアクセスされた場合のみ Secure 属性を付ける
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 },
}));

app.use(csrf);
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.use(require('./routes/auth'));

// 以降の画面はすべてログイン必須
app.use(requireLogin);
app.use('/', require('./routes/dashboard'));
app.use('/employees', require('./routes/employees'));
app.use('/users', require('./routes/users'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'ページが見つかりません', message: 'お探しのページは存在しません。' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // ECONNREFUSED 等のネットワークエラー、または PostgreSQL の接続・認証系エラー（08xxx / 28xxx / 3D000）
  const isDb = /^(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|08|28|3D)/.test(err.code || '');
  res.status(500).render('error', {
    title: 'システムエラー',
    message: isDb
      ? 'データベースに接続できません。DB の接続設定（DB_HOST 等）やセキュリティグループを確認してください。'
      : 'システムエラーが発生しました。しばらくしてから再度お試しください。',
    detail: config.env === 'production' ? null : err.message,
  });
});

module.exports = app;
