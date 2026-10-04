import { defineConfig } from '@playwright/test'
const port = process.env.PLAYWRIGHT_PORT || '5173'
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid Playwright port.')
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({ testDir: './tests/ui', timeout: 30000, workers: 1, use: { baseURL, headless: true }, webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false } })
