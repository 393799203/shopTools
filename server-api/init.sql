CREATE TABLE IF NOT EXISTS sensitive_words (
    id TEXT PRIMARY KEY,
    word TEXT NOT NULL,
    company_id TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(word, company_id)
);

CREATE INDEX IF NOT EXISTS idx_words_company ON sensitive_words(company_id);
CREATE INDEX IF NOT EXISTS idx_words_created_at ON sensitive_words(created_at);

CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    license_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    duration_days INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);

-- 设备表（以 MAC 为核心）
CREATE TABLE IF NOT EXISTS devices (
    mac TEXT PRIMARY KEY,
    current_token TEXT NOT NULL UNIQUE,
    current_secret TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 设备使用激活码历史
CREATE TABLE IF NOT EXISTS device_license_history (
    id TEXT PRIMARY KEY,
    device_mac TEXT NOT NULL REFERENCES devices(mac),
    license_key TEXT NOT NULL,
    license_id TEXT REFERENCES licenses(id),
    duration_days INTEGER,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_history_mac ON device_license_history(device_mac);

CREATE TABLE IF NOT EXISTS used_nonces (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    nonce TEXT NOT NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_used_nonces_token ON used_nonces(token);
CREATE INDEX IF NOT EXISTS idx_used_nonces_expires ON used_nonces(expires_at);