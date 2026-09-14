import mongoose, { Schema, Types } from 'mongoose';

export interface IAdminSession {
  admin_id: Types.ObjectId;
  admin_email: string;
  token_hash: string;
  expires_at: Date;
  revoked_at?: Date | null;
  created_at: Date;
}

const AdminSessionSchema = new Schema<IAdminSession>(
  {
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    admin_email: { type: String, required: true, lowercase: true },
    token_hash: { type: String, required: true, unique: true, index: true },
    expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revoked_at: { type: Date, default: null, index: true },
    created_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

export const AdminSession = mongoose.model<IAdminSession>('AdminSession', AdminSessionSchema);
