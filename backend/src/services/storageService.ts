import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

type StorageEnvironment = Record<string, string | undefined>;

export type StorageConfiguration =
  | { mode: 'local' }
  | {
      mode: 'r2';
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      publicBaseUrl?: string;
    };

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

/** Validate configuration without making a network request or exposing credential values. */
export function resolveStorageConfiguration(env: StorageEnvironment): StorageConfiguration {
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
  const values = Object.fromEntries(names.map((name) => [name, env[name]?.trim() || ''])) as Record<typeof names[number], string>;
  const configuredCount = names.filter((name) => values[name]).length;

  if (configuredCount === 0) {
    const runtime = env.NODE_ENV?.trim().toLowerCase() || 'development';
    if (!['development', 'test'].includes(runtime)) {
      throw new StorageConfigurationError('R2 storage is required outside local development and test');
    }
    return { mode: 'local' };
  }

  const missing = names.filter((name) => !values[name]);
  if (missing.length) {
    throw new StorageConfigurationError(`Incomplete R2 configuration; missing: ${missing.join(', ')}`);
  }
  if (!/^[a-fA-F0-9]{32}$/.test(values.R2_ACCOUNT_ID)) {
    throw new StorageConfigurationError('R2_ACCOUNT_ID must be a 32-character hexadecimal account identifier');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values.R2_BUCKET)) {
    throw new StorageConfigurationError('R2_BUCKET has an invalid bucket name');
  }

  let publicBaseUrl: string | undefined;
  if (env.R2_PUBLIC_BASE_URL?.trim()) {
    try {
      const parsed = new URL(env.R2_PUBLIC_BASE_URL.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
      publicBaseUrl = parsed.toString().replace(/\/$/, '');
    } catch {
      throw new StorageConfigurationError('R2_PUBLIC_BASE_URL must be a valid HTTP(S) URL');
    }
  }

  return {
    mode: 'r2',
    accountId: values.R2_ACCOUNT_ID,
    accessKeyId: values.R2_ACCESS_KEY_ID,
    secretAccessKey: values.R2_SECRET_ACCESS_KEY,
    bucket: values.R2_BUCKET,
    publicBaseUrl
  };
}

function safeKeyComponent(value: string, maximum = 128): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, maximum) || '_';
  if (sanitized === value && sanitized !== '.' && sanitized !== '..') return sanitized;
  const suffix = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${sanitized.slice(0, Math.max(1, maximum - 13))}_${suffix}`;
}

export function recordingSliceObjectKey(
  deviceSn: string,
  sessionId: string,
  serial: string,
  fileName: string
): string {
  return `recordings/${safeKeyComponent(deviceSn)}/${safeKeyComponent(sessionId)}/slices/${safeKeyComponent(serial, 20)}-${safeKeyComponent(fileName, 255)}`;
}

export function recordingWavObjectKey(deviceSn: string, sessionId: string, recordId: string): string {
  return `recordings/${safeKeyComponent(deviceSn)}/${safeKeyComponent(sessionId)}/wav/${safeKeyComponent(recordId)}.wav`;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404;
}

export interface StoredDownload {
  stream: Readable;
  contentLength: number;
}

export class StorageService {
  public readonly configuration: StorageConfiguration;
  private readonly client?: S3Client;

  constructor(env: StorageEnvironment = process.env) {
    this.configuration = resolveStorageConfiguration(env);
    if (this.configuration.mode === 'r2') {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.configuration.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.configuration.accessKeyId,
          secretAccessKey: this.configuration.secretAccessKey
        }
      });
    }
  }

  public get usesR2(): boolean {
    return this.configuration.mode === 'r2';
  }

  private requireR2(): { client: S3Client; bucket: string } {
    if (this.configuration.mode !== 'r2' || !this.client) {
      throw new StorageConfigurationError('R2 credentials are unavailable for this object');
    }
    return { client: this.client, bucket: this.configuration.bucket };
  }

  private safeLocalPath(localPath: string): string {
    const uploadRoot = path.resolve(config.uploadDir);
    const candidate = path.resolve(localPath);
    if (!candidate.toLowerCase().startsWith(`${uploadRoot.toLowerCase()}${path.sep}`)) {
      throw new Error('Local storage path is outside the configured upload directory');
    }
    return candidate;
  }

  public async exists(objectKey?: string | null, localPath?: string | null, minimumBytes = 1): Promise<boolean> {
    if (objectKey) {
      try {
        const { client, bucket } = this.requireR2();
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        return (result.ContentLength ?? 0) >= minimumBytes;
      } catch (error) {
        if (isNotFound(error) || error instanceof StorageConfigurationError) return false;
        throw error;
      }
    }
    if (!localPath) return false;
    try {
      const stats = await fsPromises.stat(this.safeLocalPath(localPath));
      return stats.isFile() && stats.size >= minimumBytes;
    } catch {
      return false;
    }
  }

  public async save(
    objectKey: string,
    localPath: string,
    body: Buffer,
    contentType: string
  ): Promise<{ objectKey: string | null; localPath: string | null }> {
    if (this.configuration.mode === 'r2') {
      const { client, bucket } = this.requireR2();
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType,
          IfNoneMatch: '*'
        }));
      } catch (error) {
        const status = typeof error === 'object' && error !== null && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
        if (status !== 412) throw error;
      }
      return { objectKey, localPath: null };
    }

    const safePath = this.safeLocalPath(localPath);
    await fsPromises.mkdir(path.dirname(safePath), { recursive: true });
    try {
      await fsPromises.writeFile(safePath, body, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          !await this.exists(null, safePath, 1)) {
        throw error;
      }
    }
    return { objectKey: null, localPath: safePath };
  }

  public async read(objectKey?: string | null, localPath?: string | null): Promise<Buffer> {
    if (objectKey) {
      const { client, bucket } = this.requireR2();
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      if (!result.Body) throw new Error('Stored object has no response body');
      return Buffer.from(await result.Body.transformToByteArray());
    }
    if (!localPath) throw new Error('No stored object reference is available');
    return fsPromises.readFile(this.safeLocalPath(localPath));
  }

  public async openDownload(objectKey?: string | null, localPath?: string | null): Promise<StoredDownload> {
    if (objectKey) {
      const { client, bucket } = this.requireR2();
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      if (!result.Body || !result.ContentLength) throw new Error('Stored object is empty or unavailable');
      const stream = result.Body instanceof Readable
        ? result.Body
        : Readable.from(Buffer.from(await result.Body.transformToByteArray()));
      return { stream, contentLength: result.ContentLength };
    }
    if (!localPath) throw new Error('No stored object reference is available');
    const safePath = this.safeLocalPath(localPath);
    const stats = await fsPromises.stat(safePath);
    if (!stats.isFile() || stats.size === 0) throw new Error('Local stored file is empty or unavailable');
    return { stream: fs.createReadStream(safePath), contentLength: stats.size };
  }

  public async remove(objectKey?: string | null, localPath?: string | null): Promise<void> {
    if (objectKey) {
      const { client, bucket } = this.requireR2();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
      return;
    }
    if (localPath) await fsPromises.unlink(this.safeLocalPath(localPath)).catch(() => undefined);
  }
}

export const storageService = new StorageService();
