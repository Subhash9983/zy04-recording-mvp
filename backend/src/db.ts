import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (!config.mongoUri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongoUri, {
      dbName: config.dbName,
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[Database] Connected successfully to MongoDB: ${config.dbName}`);
    return mongoose;
  } catch (error) {
    console.error('[Database] Connection failed:', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  console.log('[Database] Disconnected from MongoDB');
}
