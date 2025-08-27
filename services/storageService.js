import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const uploadAudio = async (audioBuffer, documentId) => {
  const key = `podcasts/${documentId}.mp3`;
  console.log(`Storage Service: Uploading audio to R2 at key: ${key}`);

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: audioBuffer,
    ContentType: 'audio/mpeg',
  });

  await s3.send(command);

  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  console.log(`Storage Service: Upload complete. Public URL: ${publicUrl}`);
  return publicUrl;
};

export const storageService = {
  uploadAudio,
};