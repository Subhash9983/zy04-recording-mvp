import mongoose, { Schema } from 'mongoose';

export interface IAuditLog {
  actor_admin_id?: string | null;
  actor_email?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  metadata: Record<string, unknown>;
  ip?: string | null;
  user_agent?: string | null;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actor_admin_id: { type: String, default: null },
    actor_email: { type: String, default: null, lowercase: true },
    action: { type: String, required: true, maxlength: 128, index: true },
    target_type: { type: String, required: true, maxlength: 128, index: true },
    target_id: { type: String, maxlength: 256, default: null },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
    ip: { type: String, maxlength: 64, default: null },
    user_agent: { type: String, maxlength: 512, default: null },
    created_at: { type: Date, default: Date.now, immutable: true, index: true }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

AuditLogSchema.index(
  { target_type: 1, target_id: 1, created_at: -1 },
  { name: 'audit_target_history' }
);

const appendOnlyError = () => {
  throw new Error('Audit history is append-only');
};
AuditLogSchema.pre('updateOne', appendOnlyError);
AuditLogSchema.pre('updateMany', appendOnlyError);
AuditLogSchema.pre('findOneAndUpdate', appendOnlyError);
AuditLogSchema.pre('replaceOne', appendOnlyError);
AuditLogSchema.pre('findOneAndReplace', appendOnlyError);
AuditLogSchema.pre('deleteOne', appendOnlyError);
AuditLogSchema.pre('deleteMany', appendOnlyError);
AuditLogSchema.pre('findOneAndDelete', appendOnlyError);
AuditLogSchema.pre('bulkWrite', appendOnlyError);
AuditLogSchema.pre('save', function enforceInsertOnly() {
  if (!this.isNew) throw new Error('Audit history is append-only');
});

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
