'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { connectionOptions } = require('./db');

const readSql = (name) => fs.readFileSync(path.join(__dirname, '..', 'db', name), 'utf8');

/**
 * データベースが無ければ作成する。
 * RDS 作成時に「最初のデータベース名」を指定しなかった場合に備え、postgres DB に接続して確認する。
 */
async function ensureDatabase(log) {
  const client = new Client(connectionOptions({ database: 'postgres' }));
  try {
    await client.connect();
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${config.db.database.replace(/"/g, '""')}" ENCODING 'UTF8'`);
      log(`データベース "${config.db.database}" を作成しました`);
    } else {
      log(`データベース "${config.db.database}" を確認しました`);
    }
  } catch (err) {
    // CREATE DATABASE 権限が無い場合などは、既存 DB がある前提で続行する
    log(`[注意] データベースの存在確認をスキップしました: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * データベース・テーブルを作成し、初期データを投入する（何度実行しても安全）
 */
async function migrate({ log = console.log } = {}) {
  await ensureDatabase(log);

  const client = new Client(connectionOptions());
  await client.connect();
  try {
    // テーブル作成（複数ステートメントを一括実行）
    await client.query(readSql('schema.sql'));
    log('テーブルを作成しました（users / employees / login_history）');

    // 初期管理者ユーザー
    const admins = await client.query('SELECT id FROM users WHERE username = $1', [config.admin.username]);
    if (admins.rowCount === 0) {
      const hash = await bcrypt.hash(config.admin.password, 10);
      await client.query(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, 'システム管理者', 'admin')",
        [config.admin.username, hash]
      );
      log(`管理者ユーザー "${config.admin.username}" を作成しました`);
    } else {
      log(`管理者ユーザー "${config.admin.username}" は既に存在します（スキップ）`);
    }

    // サンプル社員データ
    const { rows: [{ cnt }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM employees');
    if (cnt === 0) {
      await client.query(readSql('seed.sql'));
      log('サンプル社員データを投入しました');
    } else {
      log(`社員データが ${cnt} 件存在するため、サンプル投入をスキップしました`);
    }
  } finally {
    await client.end();
  }
}

module.exports = { migrate };
