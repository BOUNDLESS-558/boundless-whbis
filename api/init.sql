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
