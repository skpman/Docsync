import { config, migrate, pool, snapshotStore } from '@docsync/common';
import { createApp } from './app.js';

await migrate();
await snapshotStore.init();

const server = createApp().listen(config.apiPort, () => {
  console.log(`DocSync API listening on :${config.apiPort}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
