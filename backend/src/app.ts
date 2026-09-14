import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { config } from './config.js';
import { recordUploadRoutes } from './routes/recordUpload.js';
import { recordingRoutes } from './routes/recordings.js';
import { deviceTimeRoutes } from './routes/deviceTime.js';
import { deviceConfigRoutes } from './routes/deviceConfig.js';
import { deviceReportRoutes } from './routes/deviceReport.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024 // 50MB
  });

  // CORS setup
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Multipart setup for supplier file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB per file
    }
  });

  // Static files for uploads directory if needed
  await app.register(fastifyStatic, {
    root: path.resolve(config.uploadDir),
    prefix: '/uploads/'
  });

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await app.register(deviceTimeRoutes);
  await app.register(deviceConfigRoutes);
  await app.register(deviceReportRoutes);
  await app.register(recordUploadRoutes);
  await app.register(recordingRoutes);

  return app;
}
