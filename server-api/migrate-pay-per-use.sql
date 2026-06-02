-- 按量付费模式迁移脚本
-- 执行时间：2026-06-02

-- 1. devices 表添加额度字段
ALTER TABLE devices ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'subscription';
COMMENT ON COLUMN devices.plan_type IS '订阅类型: subscription(订阅制) | pay_per_use(按量付费)';

ALTER TABLE devices ADD COLUMN IF NOT EXISTS quota_remaining INTEGER DEFAULT 0;
COMMENT ON COLUMN devices.quota_remaining IS '剩余额度（按量付费模式下使用）';

ALTER TABLE devices ADD COLUMN IF NOT EXISTS quota_total INTEGER DEFAULT 0;
COMMENT ON COLUMN devices.quota_total Is '总购买额度';

-- 2. licenses 表支持两种类型
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS license_type TEXT DEFAULT 'subscription';
COMMENT ON COLUMN licenses.license_type IS '激活码类型: subscription | pay_per_use';

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS quota_amount INTEGER DEFAULT 0;
COMMENT ON COLUMN licenses.quota_amount IS '按量激活码对应的额度数量';

-- 3. 额度使用记录表
CREATE TABLE IF NOT EXISTS quota_usage_log (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_mac TEXT NOT NULL REFERENCES devices(mac),
    images_count INTEGER NOT NULL,
    folder_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quota_usage_log_mac ON quota_usage_log(device_mac);
CREATE INDEX IF NOT EXISTS idx_quota_usage_log_created ON quota_usage_log(created_at);

-- 4. 额度充值记录表
CREATE TABLE IF NOT EXISTS quota_orders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_mac TEXT NOT NULL REFERENCES devices(mac),
    amount INTEGER NOT NULL,
    order_no TEXT UNIQUE NOT NULL,
    payment_status TEXT DEFAULT 'paid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quota_orders_mac ON quota_orders(device_mac);

-- 完成
SELECT '✅ 按量付费模式迁移完成' AS status;
