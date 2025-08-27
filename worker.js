import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { promises as fs } from 'fs';

import connectDB from './config/db.js';
import Document from './models/document.model.js';
import ChatRoom from './models/chatRoom.model.js';
import { aiService } from './services/aiService.js';
import { ttsService } from './services/ttsService.js';
import { storageService } from './services/storageService.js';

dotenv.config();
connectDB();

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: 'embedding-001',
  apiKey: process.env.GOOGLE_API_KEY,
});

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    switch (job.name) {
      case 'file-processing-job': {
        const { path, documentId, qdrantCollectionName } = job.data;
        console.log(`Processing file job ${job.id} for document ${documentId}`);
        try {
          await Document.findByIdAndUpdate(documentId, { status: 'PROCESSING' });
          const loader = new PDFLoader(path);
          const docs = await loader.load();
          if (docs.length === 0) throw new Error('No content loaded from PDF.');

          await QdrantVectorStore.fromDocuments(docs, embeddings, {
            url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, collectionName: qdrantCollectionName,
          });

          const completedDocument = await Document.findByIdAndUpdate(documentId, { status: 'COMPLETED' }, { new: true });
          await ChatRoom.create({
            userId: completedDocument.userId, documentId: completedDocument._id, title: completedDocument.fileName,
          });
          console.log(`File job ${job.id} completed. Chat room created.`);
        } catch (error) {
          console.error(`File job ${job.id} failed for document ${documentId}:`, error);
          await Document.findByIdAndUpdate(documentId, { status: 'FAILED' });
        }
        break;
      }

      case 'podcast-generation-job': {
        const { documentId, pdfPath } = job.data;
        console.log(`Generating podcast job ${job.id} for document ${documentId}`);
        try {
          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'GENERATING' });

          const script = await aiService.generateScriptFromPDF(pdfPath);
          if (!script) throw new Error("Script generation failed.");

          const audioBuffer = await ttsService.textToAudioBuffer(script);
          if (!audioBuffer) throw new Error("TTS conversion failed.");

          const podcastUrl = await storageService.uploadAudio(audioBuffer, documentId);
if (!podcastUrl) throw new Error("Audio upload failed.");

          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'COMPLETED', podcastUrl: podcastUrl });
          console.log(`Podcast job ${job.id} successful for document ${documentId}`);

          try {
            await fs.unlink(pdfPath);
            console.log(`Successfully deleted temporary file after podcast: ${pdfPath}`);
          } catch (cleanupError) {
            console.error(`Error during post-podcast file cleanup:`, cleanupError);
          }
        } catch (error) {
          console.error(`Podcast job ${job.id} failed for document ${documentId}:`, error);
          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'FAILED' });
        }
        break;
      }
      default:
        console.warn(`Worker received unknown job type: ${job.name}`);
    }
  }, { connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT, 10), password: process.env.REDIS_PASSWORD, tls: {} }, concurrency: 5, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } }
);

console.log('Worker is listening for jobs...');