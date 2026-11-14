import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/tune/*.sim.ts'], testTimeout: 600000 } });
