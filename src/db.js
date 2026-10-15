'use strict';

const fs = require('fs');
const { Pool, types } = require('pg');
const config = require('./config');

// 日時は日本時間の文字列 "YYYY-MM-DD HH:mm:ss" で扱う
const toJst = (v) => new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
types.setTypeParser(1184, toJst); // timestamptz
types.setTypeParser(1082, (v) => v); // date はそのまま文字列

/**
 * RDS for PostgreSQL 15 以降はデフォルトで SSL 接続が必須（rds.force_ssl=1）。
 *   DB_SSL=true                  … SSL で接続（証明書検証なし）
 *   DB_SSL=true + DB_SSL_CA=パス  … RDS の CA バンドルで証明書も検証（推奨）
 */
function sslOptions() {
  if (!config.db.ssl) return false;
  if (config.db.sslCa) return { rejectUnauthorized: true, ca: fs.readFileSync(config.db.sslCa, 'utf8') };
  return { rejectUnauthorized: false };
}

function connectionOptions({ database = config.db.database } = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database,
    ssl: sslOptions(),
    connectionTimeoutMillis: 5000,
    // RDS のデフォルトタイムゾーンは UTC のため、セッション単位で日本時間にする
    options: '-c timezone=Asia/Tokyo',
  };
}

const pool = new Pool({ ...connectionOptions(), max: 10 });

pool.on('error', (err) => {
  console.error('PostgreSQL プールでエラーが発生しました:', err.message);
});

module.exports = {
  pool,
  connectionOptions,
  // プレースホルダは $1, $2 ... 形式
  query: (sql, params) => pool.query(sql, params).then((r) => r.rows),
};
