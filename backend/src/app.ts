import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import path from 'path';
import { config } from './config.js';
import { recordUploadRoutes } from './routes/recordUpload.js';
import { recordingRoutes } from './routes/recordings.js';
import { deviceTimeRoutes } from './routes/deviceTime.js';
import { deviceConfigRoutes } from './routes/deviceConfig.js';
import { deviceReportRoutes } from './routes/deviceReport.js';
import { debugLogRoutes } from './routes/debugLog.js';
import { otaRoutes } from './routes/ota.js';
import { adminAuthRoutes } from './routes/adminAuth.js';
import { adminDashboardRoutes } from './routes/adminDashboard.js';
import { installApiActivityTracking } from './services/apiActivityService.js';
import { adminManagementRoutes } from './routes/adminManagement.js';

const API_PREFIXES = ['/api/', '/sca/', '/ota/', '/uploads/'];

function isFrontendRoute(method: string, rawUrl: string, accept?: string): boolean {
  if (method !== 'GET') return false;
  const pathname = rawUrl.split('?', 1)[0];
  if (pathname === '/health' || API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  return pathname === '/' || Boolean(accept?.includes('text/html'));
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024 // 50MB
  });

  // CORS setup
  await app.register(cors, {
    origin: config.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Multipart setup for supplier file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB per file
    }
  });

  await app.register(cookie);

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  installApiActivityTracking(app);

  // Register routes
  await app.register(deviceTimeRoutes);
  await app.register(deviceConfigRoutes);
  await app.register(deviceReportRoutes);
  await app.register(debugLogRoutes);
  await app.register(otaRoutes);
  await app.register(adminAuthRoutes);
  await app.register(adminDashboardRoutes);
  await app.register(adminManagementRoutes);
  await app.register(recordUploadRoutes);
  await app.register(recordingRoutes);

  // The production dashboard is the only publicly served static content.
  // Uploaded recordings and debug logs remain behind their API download routes.
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  await app.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
    index: ['index.html']
  });

  app.setNotFoundHandler((request, reply) => {
    if (isFrontendRoute(request.method, request.raw.url || request.url, request.headers.accept)) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route not found'
    });
  });

  return app;
}
