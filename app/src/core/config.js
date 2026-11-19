'use strict';
// อ่านค่าตั้งจาก env ครั้งเดียว · โมดูลอื่นอ่านผ่าน ctx.config (ห้ามอ่าน process.env เองเพื่อให้ test สร้าง server หลายตัวได้)
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..');

function truthy(v) {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function loadConfig(env = process.env) {
  const dbPath = path.resolve(env.DB_PATH || path.join(APP_ROOT, 'data', 'app.db'));
  const dataDir = path.resolve(env.DATA_DIR || path.dirname(dbPath));
  return {
    appRoot: APP_ROOT,
    port: Number(env.PORT || 3000),
    testMode: truthy(String(env.TEST_MODE || '').trim().toLowerCase()),
    bugMode: String(env.BUG_MODE || ''),
    dbPath,
    dataDir,
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
    // คีย์ทดสอบ (ค่าเริ่มต้นใช้ได้เฉพาะเครื่อง dev/ห้องเรียน · production ต้องตั้ง env)
    piiKey: env.PII_KEY || '',
    signKey: env.SIGN_KEY || 'egov-eservice-test-sign-key-A22',
    publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    resetOnStart: truthy(String(env.RESET_ON_START || '').trim().toLowerCase()),
    strictModules: truthy(String(env.STRICT_MODULES || '').trim().toLowerCase()),
    logRequests: truthy(String(env.LOG_REQUESTS || '').trim().toLowerCase()),
    fonts: {
      regular: path.join(APP_ROOT, 'assets', 'fonts', 'NotoSansThai-Regular.ttf'),
      bold: path.join(APP_ROOT, 'assets', 'fonts', 'NotoSansThai-Bold.ttf'),
    },
  };
}

module.exports = { loadConfig, APP_ROOT };
