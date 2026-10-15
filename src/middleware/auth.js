'use strict';

const crypto = require('crypto');

// ログイン必須
function requireLogin(req, res, next) {
  if (req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

// 管理者権限必須
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).render('error', { title: '権限エラー', message: 'この操作を行う権限がありません。' });
}

// 簡易 CSRF 対策: セッションごとのトークンを全フォームに埋め込み、POST 時に照合する
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'POST') {
    const token = req.body && req.body._csrf;
    const expected = req.session.csrfToken;
    const ok = token && token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) {
      return res.status(403).render('error', {
        title: '不正なリクエスト',
        message: 'セッションの有効期限が切れた可能性があります。画面を再読み込みしてやり直してください。',
      });
    }
  }
  return next();
}

module.exports = { requireLogin, requireAdmin, csrf };
