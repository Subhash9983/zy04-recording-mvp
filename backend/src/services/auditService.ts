import { AuditLog } from '../models/AuditLog.js';

export interface AuditActor {
  id?: string | null;
  email?: string | null;
}

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface WriteAuditLogInput {
  actor?: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > 5) return '[depth-limit]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadataValue(item, depth + 1));
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [rawKey, child] of Object.entries(value).slice(0, 100)) {
      const key = rawKey.replaceAll('.', '_').replace(/^\$/, '_').slice(0, 128) || '_';
      sanitized[key] = sanitizeMetadataValue(child, depth + 1);
    }
    return sanitized;
  }
  return String(value).slice(0, 2_000);
}

export function sanitizeAuditMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  return sanitizeMetadataValue(metadata || {}, 0) as Record<string, unknown>;
}

/** The only application write helper; the schema rejects update/delete operations. */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  await AuditLog.create({
    actor_admin_id: safeText(input.actor?.id, 128),
    actor_email: safeText(input.actor?.email, 320)?.toLowerCase() || null,
    action: safeText(input.action, 128) || 'UNKNOWN_ACTION',
    target_type: safeText(input.targetType, 128) || 'UNKNOWN_TARGET',
    target_id: safeText(input.targetId, 256),
    metadata: sanitizeAuditMetadata(input.metadata),
    ip: safeText(input.context?.ip, 64),
    user_agent: safeText(input.context?.userAgent, 512),
    created_at: new Date()
  });
}
