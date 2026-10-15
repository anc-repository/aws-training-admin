-- ============================================================
-- AWS 研修用 管理システム テーブル定義（PostgreSQL / RDS for PostgreSQL）
--   手動実行する場合:
--     psql -h <RDSエンドポイント> -U <ユーザー> -d aws_training -f db/schema.sql
--   ※ 管理者ユーザーの作成は npm run db:init で行います（パスワードをハッシュ化するため）
-- ============================================================

-- ログインユーザー
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  last_login_at TIMESTAMPTZ(0) NULL,
  created_at    TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 社員マスタ
CREATE TABLE IF NOT EXISTS employees (
  id          SERIAL PRIMARY KEY,
  employee_no VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  name_kana   VARCHAR(100) NULL,
  department  VARCHAR(100) NULL,
  position    VARCHAR(100) NULL,
  email       VARCHAR(255) NULL,
  phone       VARCHAR(30)  NULL,
  hire_date   DATE NULL,
  status      VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'retired')),
  note        TEXT NULL,
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ログイン履歴
CREATE TABLE IF NOT EXISTS login_history (
  id         BIGSERIAL PRIMARY KEY,
  username   VARCHAR(50)  NOT NULL,
  success    BOOLEAN      NOT NULL,
  ip_address VARCHAR(64)  NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history (created_at);

COMMENT ON TABLE users IS 'ログインユーザー';
COMMENT ON TABLE employees IS '社員マスタ';
COMMENT ON TABLE login_history IS 'ログイン履歴';
