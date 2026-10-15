#!/usr/bin/env node
'use strict';

// 使い方: npm run db:init
//   .env または環境変数の DB_* に接続し、DB・テーブル作成と初期データ投入を行う
const config = require('../src/config');
const { migrate } = require('../src/migrate');

(async () => {
  console.log(`接続先: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  try {
    await migrate();
    console.log('DB 初期化が完了しました。');
    process.exit(0);
  } catch (err) {
    console.error('DB 初期化に失敗しました:', err.message);
    process.exit(1);
  }
})();
