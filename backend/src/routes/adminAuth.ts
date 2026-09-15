import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  ADMIN_SESSION_COOKIE,
  AdminAuthConfigurationError,
  adminAuthService,
  InvalidAdminCredentialsError,
  requireAdmin
} from '../services/adminAuthService.js';
import { writeAuditLog } from '../services/auditService.js';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

class LoginRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginRequestError';
  }
}

function requestContext(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
  };
}

function validateLoginBody(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new LoginRequestError('JSON request body is required');
  }
  const candidate = body as LoginBody;
  if (typeof candidate.email !== 'string' || !candidate.email.trim() || candidate.email.length > 320) {
    throw new LoginRequestError('email is required');
  }
  if (typeof candidate.password !== 'string' || !candidate.password || candidate.password.length > 1_024) {
    throw new LoginRequestError('password is required');
  }
  return { email: candidate.email.trim().toLowerCase(), password: candidate.password };
}

const cookieBaseOptions = {
  path: '/api/admin',
  httpOnly: true,
  sameSite: 'strict' as const
};

export const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/admin/auth/login', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    let email: string | null = null;
    try {
      const credentials = validateLoginBody(request.body);
      email = credentials.email;
      const session = await adminAuthService.login(credentials.email, credentials.password);

      try {
        await writeAuditLog({
          actor: { id: session.id, email: session.email },
          action: 'ADMIN_LOGIN_SUCCEEDED',
          targetType: 'ADMIN',
          targetId: session.id,
          metadata: {},
          context: requestContext(request)
        });
      } catch (error) {
        await adminAuthService.logout(session.cookieValue).catch(() => undefined);
        throw error;
      }

      reply.setCookie(ADMIN_SESSION_COOKIE, session.cookieValue, {
        ...cookieBaseOptions,
        secure: adminAuthService.configuration.enabled && adminAuthService.configuration.secureCookie,
        maxAge: 24 * 60 * 60,
        expires: session.expiresAt
      });
      return reply.status(200).send({
        code: 0,
        data: { email: session.email, expires_at: session.expiresAt.toISOString() }
      });
    } catch (error) {
      if (error instanceof LoginRequestError) {
        return reply.status(400).send({ code: 400, msg: error.message });
      }
      if (error instanceof InvalidAdminCredentialsError) {
        await writeAuditLog({
          actor: { email },
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'ADMIN',
          targetId: email,
          metadata: { reason: 'invalid_credentials' },
          context: requestContext(request)
        });
        return reply.status(401).send({ code: 401, msg: 'Invalid email or password' });
      }
      if (error instanceof AdminAuthConfigurationError) {
        return reply.status(503).send({ code: 503, msg: 'Admin authentication is unavailable' });
      }
      request.log.error(error);
      return reply.status(500).send({ code: 500, msg: 'Admin login failed' });
    }
  });

  fastify.get('/api/admin/auth/me', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.status(200).send({
      code: 0,
      data: {
        id: request.admin!.id,
        email: request.admin!.email,
        expires_at: request.admin!.expiresAt.toISOString()
      }
    });
  });

  fastify.post('/api/admin/auth/logout', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      await adminAuthService.logout(request.adminSessionCookie);
      reply.clearCookie(ADMIN_SESSION_COOKIE, {
        ...cookieBaseOptions,
        secure: adminAuthService.configuration.enabled && adminAuthService.configuration.secureCookie
      });
      await writeAuditLog({
        actor: { id: request.admin!.id, email: request.admin!.email },
        action: 'ADMIN_LOGOUT',
        targetType: 'ADMIN_SESSION',
        targetId: request.admin!.id,
        metadata: {},
        context: requestContext(request)
      });
      return reply.status(200).send({ code: 0 });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ code: 500, msg: 'Admin logout failed' });
    }
  });
};
