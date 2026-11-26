-- 车辆营运信息表：Vercel + Neon Postgres
-- 部署后在 Neon 控制台 SQL Editor 执行一次本文件即可

CREATE TABLE IF NOT EXISTS vehicle_ops (
  org_id TEXT PRIMARY KEY,
  line_no TEXT,
  company TEXT,
  max_speed NUMERIC DEFAULT 0,
  speed_count INTEGER DEFAULT 0,
  online_at TEXT,
  offline_at TEXT,
  departures INTEGER DEFAULT 0,
  transfers JSONB DEFAULT '[]'::jsonb,
  lines JSONB DEFAULT '[]'::jsonb,
  samples INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_ops_line_no ON vehicle_ops (line_no);
CREATE INDEX IF NOT EXISTS idx_vehicle_ops_updated ON vehicle_ops (updated_at DESC);

-- 按日营运信息：数据面板的历史真源（PK = 日期 + 自编号）
CREATE TABLE IF NOT EXISTS vehicle_ops_daily (
  date DATE NOT NULL,
  org_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT '',
  line_no TEXT,
  company TEXT,
  max_speed NUMERIC DEFAULT 0,
  speed_count INTEGER DEFAULT 0,
  online_at TEXT,
  offline_at TEXT,
  departures INTEGER DEFAULT 0,
  transfers JSONB DEFAULT '[]'::jsonb,
  lines JSONB DEFAULT '[]'::jsonb,
  samples INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (date, org_id)
);
CREATE INDEX IF NOT EXISTS idx_vod_date ON vehicle_ops_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_vod_company_date ON vehicle_ops_daily (company, date DESC);
CREATE INDEX IF NOT EXISTS idx_vod_line_date ON vehicle_ops_daily (line_no, date DESC);

-- 账号与会话（本地预置账号 seed 由 /api/auth 首次请求时写入）
CREATE TABLE IF NOT EXISTS app_accounts (
  norm_account TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_sessions (
  token TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
