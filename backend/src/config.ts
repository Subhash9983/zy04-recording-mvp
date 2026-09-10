import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface Config {
  port: number;
  host: string;
  mongoUri: string;
  dbName: string;
  uploadDir: string;
  frontendUrl: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/zy04_mvp',
  dbName: process.env.DATABASE_NAME || 'zy04_mvp',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
};
