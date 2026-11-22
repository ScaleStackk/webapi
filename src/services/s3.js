import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

let client;

function s3Client() {
  if (!client) {
    client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle,
    });
  }
  return client;
}

export function judgmentObjectKey(documentId) {
  return `${config.s3.prefix}/${documentId}/source.pdf`;
}

export async function createPdfUpload({ documentId }) {
  const key = judgmentObjectKey(documentId);
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: "application/pdf",
    ServerSideEncryption: config.s3.encryption || undefined,
    SSEKMSKeyId: config.s3.kmsKeyId,
  });
  const uploadUrl = await getSignedUrl(s3Client(), command, {
    expiresIn: config.s3.presignSeconds,
    signableHeaders: new Set(["content-type"]),
  });

  const uploadHeaders = { "Content-Type": "application/pdf" };
  if (config.s3.encryption) {
    uploadHeaders["x-amz-server-side-encryption"] = config.s3.encryption;
  }
  if (config.s3.kmsKeyId) {
    uploadHeaders["x-amz-server-side-encryption-aws-kms-key-id"] = config.s3.kmsKeyId;
  }

  return {
    uploadUrl,
    uploadHeaders,
    expiresInSeconds: config.s3.presignSeconds,
    storage: {
      bucket: config.s3.bucket,
      key,
      uri: `s3://${config.s3.bucket}/${key}`,
    },
  };
}

// Short-lived link for viewing a judgment PDF in the browser; sources append
// "#page=N" so the PDF opens at the cited page.
export async function createPdfViewUrl(documentId) {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: judgmentObjectKey(documentId),
    ResponseContentType: "application/pdf",
    ResponseContentDisposition: "inline",
  });
  return getSignedUrl(s3Client(), command, { expiresIn: config.s3.presignSeconds });
}

export async function inspectUploadedPdf(documentId) {
  const key = judgmentObjectKey(documentId);
  const object = await s3Client().send(
    new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }),
  );
  return {
    bucket: config.s3.bucket,
    key,
    uri: `s3://${config.s3.bucket}/${key}`,
    contentLength: Number(object.ContentLength || 0),
    contentType: object.ContentType || "",
    etag: object.ETag?.replaceAll('"', "") || null,
    lastModified: object.LastModified?.toISOString() || null,
  };
}
