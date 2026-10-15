'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const FIELDS = ['employee_no', 'name', 'name_kana', 'department', 'position', 'email', 'phone', 'hire_date', 'status', 'note'];
const STATUSES = ['active', 'leave', 'retired'];
const PAGE_SIZE = 20;
const UNIQUE_VIOLATION = '23505';

function readForm(body) {
  const data = {};
  for (const f of FIELDS) {
    const v = String(body[f] ?? '').trim();
    data[f] = v === '' ? null : v;
  }
  if (!STATUSES.includes(data.status)) data.status = 'active';
  return data;
}

function validate(data) {
  const errors = [];
  if (!data.employee_no) errors.push('社員番号は必須です。');
  else if (!/^[A-Za-z0-9-]{1,20}$/.test(data.employee_no)) errors.push('社員番号は半角英数字・ハイフン20文字以内で入力してください。');
  if (!data.name) errors.push('氏名は必須です。');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('メールアドレスの形式が正しくありません。');
  if (data.hire_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.hire_date)) errors.push('入社日の形式が正しくありません。');
  return errors;
}

// :id は数値のみ受け付ける（PostgreSQL は型不一致でエラーになるため事前にチェック）
router.param('id', (req, res, next, id) => (
  /^\d{1,9}$/.test(id) ? next() : res.status(404).render('error', { title: '見つかりません', message: '指定された社員は存在しません。' })
));

// 一覧・検索
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const where = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      where.push('(employee_no ILIKE $1 OR name ILIKE $1 OR name_kana ILIKE $1 OR department ILIKE $1 OR email ILIKE $1)');
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [{ total }] = await db.query(`SELECT COUNT(*)::int AS total FROM employees ${whereSql}`, params);
    const employees = await db.query(
      `SELECT * FROM employees ${whereSql} ORDER BY employee_no LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    );

    res.render('employees/index', {
      title: '社員管理',
      employees,
      q,
      status,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      flash: req.session.flash,
    });
    delete req.session.flash;
  } catch (err) {
    next(err);
  }
});

// 新規登録
router.get('/new', (req, res) => {
  res.render('employees/form', {
    title: '社員の新規登録',
    employee: { status: 'active' },
    errors: [],
    action: '/employees',
  });
});

router.post('/', async (req, res, next) => {
  const data = readForm(req.body);
  const errors = validate(data);
  if (errors.length) {
    return res.status(400).render('employees/form', { title: '社員の新規登録', employee: data, errors, action: '/employees' });
  }
  try {
    await db.query(`INSERT INTO employees (${FIELDS.join(', ')}) VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(', ')})`,
      FIELDS.map((f) => data[f]));
    req.session.flash = `社員「${data.name}」を登録しました。`;
    return res.redirect('/employees');
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(400).render('employees/form', {
        title: '社員の新規登録', employee: data, errors: ['この社員番号は既に登録されています。'], action: '/employees',
      });
    }
    return next(err);
  }
});

// 編集
router.get('/:id/edit', async (req, res, next) => {
  try {
    const [employee] = await db.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
    if (!employee) return res.status(404).render('error', { title: '見つかりません', message: '指定された社員は存在しません。' });
    return res.render('employees/form', {
      title: '社員情報の編集', employee, errors: [], action: `/employees/${employee.id}`,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id', async (req, res, next) => {
  const data = readForm(req.body);
  const errors = validate(data);
  const action = `/employees/${req.params.id}`;
  if (errors.length) {
    return res.status(400).render('employees/form', { title: '社員情報の編集', employee: { ...data, id: req.params.id }, errors, action });
  }
  try {
    await db.query(
      `UPDATE employees SET ${FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${FIELDS.length + 1}`,
      [...FIELDS.map((f) => data[f]), req.params.id]
    );
    req.session.flash = `社員「${data.name}」の情報を更新しました。`;
    return res.redirect('/employees');
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(400).render('employees/form', {
        title: '社員情報の編集', employee: { ...data, id: req.params.id }, errors: ['この社員番号は既に登録されています。'], action,
      });
    }
    return next(err);
  }
});

// 削除
router.post('/:id/delete', async (req, res, next) => {
  try {
    const [employee] = await db.query('DELETE FROM employees WHERE id = $1 RETURNING name', [req.params.id]);
    if (employee) req.session.flash = `社員「${employee.name}」を削除しました。`;
    res.redirect('/employees');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
