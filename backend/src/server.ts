import { buildApp } from './app.js';
import { connectToDatabase, disconnectDatabase } from './db.js';
import { config } from './config.js';

async function start() {
  try {
    console.log('[Server] Connecting to database...');
    await connectToDatabase();

    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: config.host
    });

    console.log(`[Server] ZY04 Backend running on http://${config.host}:${config.port}`);
    console.log(`[Server] Upload endpoint: POST http://${config.host}:${config.port}/sca/recordupload`);

    const closeHandler = async (signal: string) => {
      console.log(`[Server] Received ${signal}, closing gracefully...`);
      await app.close();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGINT', () => closeHandler('SIGINT'));
    process.on('SIGTERM', () => closeHandler('SIGTERM'));
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
}

start();
