import path from 'path';
import { config } from '../config.js';
import { DebugLog } from '../models/DebugLog.js';
import { Device } from '../models/Device.js';
import { debugLogObjectKey, storageService } from './storageService.js';

export interface SaveDebugLogInput {
  sn: string;
  timestamp: string;
  fileName: string;
  fileBuffer: Buffer;
}

export class DebugLogService {
  public async save(input: SaveDebugLogInput): Promise<void> {
    const now = new Date();
    const objectKey = debugLogObjectKey(input.sn, input.timestamp, input.fileName);
    const localPath = path.join(config.uploadDir, ...objectKey.split('/'));

    await Device.findOneAndUpdate(
      { sn: input.sn },
      {
        $set: { last_seen_at: now, updated_at: now },
        $setOnInsert: {
          product: 'UNKNOWN',
          model: 'UNKNOWN',
          version: 'UNKNOWN',
          created_at: now
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const stored = await storageService.save(
      objectKey,
      localPath,
      input.fileBuffer,
      'application/octet-stream'
    );

    await DebugLog.findOneAndUpdate(
      { sn: input.sn, ts: input.timestamp, file_name: input.fileName },
      {
        $set: {
          size: input.fileBuffer.length,
          object_key: stored.objectKey,
          local_path: stored.localPath,
          storage_mode: stored.objectKey ? 'R2' : 'LOCAL',
          deleted_at: null
        },
        $setOnInsert: { uploaded_at: now }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

export const debugLogService = new DebugLogService();
