import mongoose, { Schema } from 'mongoose';

export interface IAdmin {
  admin_key: 'PRIMARY';
  email: string;
  password_hash: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    admin_key: { type: String, enum: ['PRIMARY'], default: 'PRIMARY', unique: true, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    password_hash: { type: String, required: true, select: false },
    enabled: { type: Boolean, default: true, required: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

export const Admin = mongoose.model<IAdmin>('Admin', AdminSchema);
