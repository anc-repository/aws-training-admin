'use strict';

const os = require('os');
const express = require('express');
const db = require('../db');
const config = require('../config');
const pkg = require('../../package.json');

const router = express.Router();

const DEPLOY_LABELS = {
  cloudformation: '方式1: AWS CloudFormation による一括デプロイ',
  'manual-ec2': '方式2: EC2 + nginx 手動デプロイ（DB は手動作成 → RDS へ移行）',
  'cicd-codepipeline': '方式3: CI/CD（CodePipeline + CodeDeploy）',
  'cicd-github-actions': '方式3: CI/CD（GitHub Actions）',
  local: 'ローカル開発環境',
};

// EC2 インスタンスメタデータ（IMDSv2）を取得。EC2 以外では null を返す
let metadataCache;
async function getEc2Metadata() {
  if (metadataCache !== undefined) return metadataCache;
  const base = 'http://169.254.169.254/latest';
  try {
    const tokenRes = await fetch(`${base}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
      signal: AbortSignal.timeout(500),
    });
    if (!tokenRes.ok) throw new Error('no token');
    const token = await tokenRes.text();
    const get = async (p) => {
      const r = await fetch(`${base}/meta-data/${p}`, {
        headers: { 'X-aws-ec2-metadata-token': token },
        signal: AbortSignal.timeout(500),
      });
      return r.ok ? r.text() : '-';
    };
    const [instanceId, instanceType, az, privateIp] = await Promise.all([
      get('instance-id'), get('instance-type'), get('placement/availability-zone'), get('local-ipv4'),
    ]);
    metadataCache = { instanceId, instanceType, az, privateIp };
  } catch {
    metadataCache = null;
  }
  return metadataCache;
}

router.get('/', async (req, res, next) => {
  try {
    let dbInfo;
    try {
      const [row] = await db.query("SELECT current_setting('server_version') AS version, current_database() AS name, NOW() AS now");
      dbInfo = { ok: true, ...row };
    } catch (err) {
      dbInfo = { ok: false, error: err.message };
    }

    const stats = dbInfo.ok
      ? (await db.query(`
          SELECT
            (SELECT COUNT(*)::int FROM employees) AS total,
            (SELECT COUNT(*)::int FROM employees WHERE status = 'active') AS active,
            (SELECT COUNT(*)::int FROM employees WHERE status = 'leave') AS "leaveCount",
            (SELECT COUNT(*)::int FROM users) AS users`))[0]
      : null;

    const departments = dbInfo.ok
      ? await db.query(`
          SELECT COALESCE(department, '未設定') AS department, COUNT(*)::int AS cnt
          FROM employees WHERE status <> 'retired'
          GROUP BY 1 ORDER BY cnt DESC`)
      : [];

    const logins = dbInfo.ok
      ? await db.query('SELECT username, success, ip_address, created_at FROM login_history ORDER BY id DESC LIMIT 8')
      : [];

    res.render('dashboard', {
      title: 'ダッシュボード',
      stats,
      departments,
      logins,
      dbInfo,
      server: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        node: process.version,
        uptime: Math.floor(process.uptime()),
        appVersion: pkg.version,
        deployMethod: DEPLOY_LABELS[config.deployMethod] || config.deployMethod,
        dbHost: config.db.host,
        ec2: await getEc2Metadata(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
