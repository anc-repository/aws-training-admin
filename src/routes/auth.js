'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  return res.render('login', { title: 'ログイン', error: null, username: '' });
});

router.post('/login', async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  try {
    const [user] = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;

    await db.query(
      'INSERT INTO login_history (username, success, ip_address, user_agent) VALUES ($1, $2, $3, $4)',
      [username.slice(0, 50), ok, req.ip, String(req.get('user-agent') || '').slice(0, 255)]
    );

    if (!ok) {
      return res.status(401).render('login', {
        title: 'ログイン',
        error: 'ユーザー名またはパスワードが正しくありません。',
        username,
      });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const returnTo = req.session.returnTo || '/';
    // セッション固定攻撃対策としてログイン時にセッション ID を再生成
    return req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      };
      return req.session.save(() => res.redirect(returnTo));
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
