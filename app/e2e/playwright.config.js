// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// เครื่องที่มี browser ไม่ตรงเวอร์ชัน @playwright/test (เช่นนอก docker) ตั้ง PW_EXECUTABLE_PATH ให้ชี้ chrome-headless-shell ได้
const EXEC = process.env.PW_EXECUTABLE_PATH || '';

module.exports = defineConfig({
  testDir: './specs',
  // ไฟล์ helper (_lib.js) ไม่ใช่ test
  testMatch: /.*\.spec\.js$/,
  globalSetup: require.resolve('./global-setup.js'),
  // ทุก TC ใช้ฐานข้อมูลเดียวกันและเริ่มด้วย POST /api/test/reset → ต้องรันทีละ test
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(__dirname, 'results', 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(__dirname, 'results', 'results.json') }],
  ],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-testid',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL: BASE_URL, ...(EXEC ? { launchOptions: { executablePath: EXEC } } : {}) } },
  ],
});
