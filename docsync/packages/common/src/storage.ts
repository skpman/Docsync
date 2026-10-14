import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/** Object store for document snapshots (version history). */
export interface SnapshotStore {
  init(): Promise<void>;
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
}

class S3Store implements SnapshotStore {
  private client: S3Client;
  private bucket = config.storage.s3Bucket;

  constructor() {
    this.client = new S3Client({
      region: config.storage.s3Region,
      endpoint: config.storage.s3Endpoint,
      forcePathStyle: !!config.storage.s3Endpoint, // MinIO
      credentials: { accessKeyId: config.storage.s3AccessKey, secretAccessKey: config.storage.s3SecretKey },
    });
  }

  async init() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).catch((err) => {
        if (err?.name !== 'BucketAlreadyOwnedByYou') throw err;
      });
    }
  }

  async put(key: string, body: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/octet-stream' }),
    );
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body!.transformToByteArray();
  }

  async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

class FsStore implements SnapshotStore {
  private root = path.resolve(config.storage.fsDir);
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid key');
    return full;
  }
  async init() {
    await mkdir(this.root, { recursive: true });
  }
  async put(key: string, body: Uint8Array) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.resolve(key)));
  }
  async deletePrefix(prefix: string) {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

export const snapshotStore: SnapshotStore = config.storage.driver === 'fs' ? new FsStore() : new S3Store();

export const snapshotKey = (documentId: string, version: number) =>
  `docs/${documentId}/v${String(version).padStart(6, '0')}.ydoc`;
