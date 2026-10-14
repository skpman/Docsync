function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number(v) : fallback;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://docsync:docsync@localhost:5432/docsync',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  internalSecret: process.env.INTERNAL_SECRET ?? 'dev-internal-secret',
  apiPort: num('API_PORT', 4000),
  syncPort: num('SYNC_PORT', 4001),
  syncInternalUrl: process.env.SYNC_INTERNAL_URL ?? 'http://localhost:4001',
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'fs',
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: process.env.S3_BUCKET ?? 'docsync-snapshots',
    s3AccessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    s3SecretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    fsDir: process.env.FS_STORAGE_DIR ?? '.data/snapshots',
  },
  persistDebounceMs: num('PERSIST_DEBOUNCE_MS', 2000),
  persistMaxWaitMs: num('PERSIST_MAX_WAIT_MS', 10000),
  snapshotIntervalMs: num('SNAPSHOT_INTERVAL_MS', 5 * 60 * 1000),
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
