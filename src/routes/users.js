'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

async function renderList(req, res, { errors = [], form = {} } = {}) {
  const users = await db.query(
    'SELECT id, username, display_name, role, last_login_at, created_at FROM users ORDER BY id'
  );
  res.status(errors.length ? 400 : 200).render('users/index', {
    title: 'ユーザー管理',
    users,
    errors,
    form,
    flash: req.session.flash,
  });
  delete req.session.flash;
}

router.use(requireAdmin);

router.param('id', (req, res, next, id) => (
  /^\d{1,9}$/.test(id) ? next() : res.status(404).render('error', { title: '見つかりません', message: '指定されたユーザーは存在しません。' })
));

router.get('/', (req, res, next) => renderList(req, res).catch(next));

// ユーザー追加
router.post('/', async (req, res, next) => {
  const form = {
    username: String(req.body.username || '').trim(),
    display_name: String(req.body.display_name || '').trim(),
    role: req.body.role === 'admin' ? 'admin' : 'user',
  };
  const password = String(req.body.password || '');

  const errors = [];
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(form.username)) errors.push('ユーザー名は半角英数字（3〜50文字）で入力してください。');
  if (!form.display_name) errors.push('表示名は必須です。');
  if (password.length < 8) errors.push('パスワードは8文字以上で入力してください。');

  try {
    if (errors.length) return await renderList(req, res, { errors, form });
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4)',
      [form.username, hash, form.display_name, form.role]);
    req.session.flash = `ユーザー「${form.username}」を追加しました。`;
    return res.redirect('/users');
  } catch (err) {
    if (err.code === '23505') { // 一意制約違反
      return renderList(req, res, { errors: ['このユーザー名は既に使用されています。'], form }).catch(next);
    }
    return next(err);
  }
});

// パスワードリセット
router.post('/:id/password', async (req, res, next) => {
  const password = String(req.body.password || '');
  try {
    if (password.length < 8) {
      return await renderList(req, res, { errors: ['パスワードは8文字以上で入力してください。'] });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);
    req.session.flash = 'パスワードを変更しました。';
    return res.redirect('/users');
  } catch (err) {
    return next(err);
  }
});

// ユーザー削除（自分自身は削除不可）
router.post('/:id/delete', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      return await renderList(req, res, { errors: ['ログイン中のユーザーは削除できません。'] });
    }
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    req.session.flash = 'ユーザーを削除しました。';
    return res.redirect('/users');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
