// Конфиг симулятора баланса: `npm run sim`. Отдельно от тестов — `npm test` его не запускает.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tools/sim/**/*.sim.ts'], testTimeout: 600_000, silent: false },
});
