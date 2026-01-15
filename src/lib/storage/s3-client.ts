import { S3Client } from "@aws-sdk/client-s3";

let s3ClientInstance: S3Client | null = null;

/**
 * Get S3 client instance (lazy initialization).
 * This prevents build-time errors when environment variables are not set.
 */
export function getS3Client(): S3Client {
  if (s3ClientInstance) {
    return s3ClientInstance;
  }

  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 credentials are not configured. Please set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables.",
    );
  }

  s3ClientInstance = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
    // CRITICAL: forcePathStyle must be true for MinIO, false for AWS S3
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });

  return s3ClientInstance;
}

/**
 * S3 client configured for MinIO (development) or AWS S3/Cloudflare R2 (production).
 * @deprecated Use getS3Client() instead for lazy initialization
 */
export const s3Client = {
  get instance() {
    return getS3Client();
  },
};

export const BUCKET_NAME = process.env.S3_BUCKET_NAME || "uploads";
