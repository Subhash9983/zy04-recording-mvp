import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Admin } from '../models/Admin.js';
import { AdminSession } from '../models/AdminSession.js';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1_000;
export const ADMIN_SESSION_COOKIE = 'zy04_admin_session';

type AuthEnvironment = Record<string, string | undefined>;

export type AdminAuthConfiguration =
  | { enabled: false; secureCookie: false }
  | {
      enabled: true;
      email: string;
      initialPassword: string;
      sessionSecret: string;
      secureCookie: boolean;
    };

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  expiresAt: Date;
}

export interface CreatedAdminSession extends AuthenticatedAdmin {
  cookieValue: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AuthenticatedAdmin;
    adminSessionCookie?: string;
  }
}

export class AdminAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthConfigurationError';
  }
}

export class InvalidAdminCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidAdminCredentialsError';
  }
}

export class InvalidAdminSessionError extends Error {
  constructor() {
    super('Admin session is missing, invalid, or expired');
    this.name = 'InvalidAdminSessionError';
  }
}

export function resolveAdminAuthConfiguration(env: AuthEnvironment): AdminAuthConfiguration {
  const names = ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_SECRET'] as const;
  const values: Record<typeof names[number], string> = {
    ADMIN_EMAIL: env.ADMIN_EMAIL?.trim() || '',
    ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
    SESSION_SECRET: env.SESSION_SECRET || ''
  };
  const hasValue = (name: typeof names[number]) => Boolean(values[name].trim());
  const configured = names.filter(hasValue).length;
  const production = env.NODE_ENV?.trim().toLowerCase() === 'production';

  if (configured === 0 && !production) return { enabled: false, secureCookie: false };
  const missing = names.filter((name) => !hasValue(name));
  if (missing.length) {
    throw new AdminAuthConfigurationError(`Incomplete admin authentication configuration; missing: ${missing.join(', ')}`);
  }
  const email = values.ADMIN_EMAIL.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new AdminAuthConfigurationError('ADMIN_EMAIL is invalid');
  }
  if (values.ADMIN_PASSWORD.length < 12 || values.ADMIN_PASSWORD.length > 1_024) {
    throw new AdminAuthConfigurationError('ADMIN_PASSWORD must contain between 12 and 1024 characters');
  }
  if (values.SESSION_SECRET.length < 32 || values.SESSION_SECRET.length > 4_096) {
    throw new AdminAuthConfigurationError('SESSION_SECRET must contain between 32 and 4096 characters');
  }

  return {
    enabled: true,
    email,
    initialPassword: values.ADMIN_PASSWORD,
    sessionSecret: values.SESSION_SECRET,
    secureCookie: production
  };
}

function scryptPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey)
    );
  });
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptPassword(password, salt);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

export async function verifyAdminPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' ||
      parts[2] !== '8' || parts[3] !== '1') {
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scryptPassword(password, salt);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export class AdminAuthService {
  constructor(public readonly configuration: AdminAuthConfiguration) {}

  private requireConfiguration(): Extract<AdminAuthConfiguration, { enabled: true }> {
    if (!this.configuration.enabled) {
      throw new AdminAuthConfigurationError('Admin authentication is not configured');
    }
    return this.configuration;
  }

  private async getOrCreateAdmin() {
    const configuration = this.requireConfiguration();
    const existing = await Admin.findOne({ admin_key: 'PRIMARY' }).select('+password_hash');
    if (existing) return existing;

    const passwordHash = await hashAdminPassword(configuration.initialPassword);
    try {
      return await Admin.create({
        admin_key: 'PRIMARY',
        email: configuration.email,
        password_hash: passwordHash,
        enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrent = await Admin.findOne({ admin_key: 'PRIMARY' }).select('+password_hash');
      if (!concurrent) throw error;
      return concurrent;
    }
  }

  private signToken(token: string): string {
    const configuration = this.requireConfiguration();
    return crypto.createHmac('sha256', configuration.sessionSecret).update(token).digest('base64url');
  }

  private parseCookie(cookieValue?: string): string {
    if (!cookieValue) throw new InvalidAdminSessionError();
    const [token, signature, extra] = cookieValue.split('.');
    if (!token || !signature || extra) throw new InvalidAdminSessionError();
    const expected = this.signToken(token);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new InvalidAdminSessionError();
    }
    return token;
  }

  private tokenHash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  public async login(email: string, password: string): Promise<CreatedAdminSession> {
    const configuration = this.requireConfiguration();
    const admin = await this.getOrCreateAdmin();
    const passwordValid = await verifyAdminPassword(password, admin.password_hash);
    if (!admin.enabled || email.trim().toLowerCase() !== configuration.email ||
        admin.email !== configuration.email || !passwordValid) {
      throw new InvalidAdminCredentialsError();
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await AdminSession.create({
      admin_id: admin._id,
      admin_email: admin.email,
      token_hash: this.tokenHash(token),
      expires_at: expiresAt,
      revoked_at: null,
      created_at: new Date()
    });

    return {
      id: String(admin._id),
      email: admin.email,
      expiresAt,
      cookieValue: `${token}.${this.signToken(token)}`
    };
  }

  public async authenticate(cookieValue?: string): Promise<AuthenticatedAdmin> {
    this.requireConfiguration();
    const token = this.parseCookie(cookieValue);
    const session = await AdminSession.findOne({
      token_hash: this.tokenHash(token),
      revoked_at: null,
      expires_at: { $gt: new Date() }
    }).lean();
    if (!session) throw new InvalidAdminSessionError();
    return {
      id: String(session.admin_id),
      email: session.admin_email,
      expiresAt: session.expires_at
    };
  }

  public async logout(cookieValue?: string): Promise<void> {
    this.requireConfiguration();
    const token = this.parseCookie(cookieValue);
    await AdminSession.updateOne(
      {
        token_hash: this.tokenHash(token),
        revoked_at: null
      },
      { $set: { revoked_at: new Date() } }
    );
  }
}

export const adminAuthConfiguration = resolveAdminAuthConfiguration(process.env);
export const adminAuthService = new AdminAuthService(adminAuthConfiguration);

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const cookieValue = request.cookies?.[ADMIN_SESSION_COOKIE];
    request.admin = await adminAuthService.authenticate(cookieValue);
    request.adminSessionCookie = cookieValue;
  } catch {
    await reply.status(401).send({ code: 401, msg: 'Admin authentication required' });
  }
}
