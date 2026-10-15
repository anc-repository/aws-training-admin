'use strict';

const config = require('./config');
const { migrate } = require('./migrate');

async function main() {
  if (config.autoMigrate) {
    console.log('AUTO_MIGRATE=true のため、DB 初期化を実行します...');
    await migrate();
  }

  const app = require('./app');
  app.listen(config.port, () => {
    console.log(`AWS 研修管理システムを起動しました: http://localhost:${config.port} (DEPLOY_METHOD=${config.deployMethod})`);
  });
}

main().catch((err) => {
  console.error('起動に失敗しました:', err);
  process.exit(1);
});
