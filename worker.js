// server/worker.js

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { QdrantVectorStore } from '@langchain/qdrant';

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
        const { path: fileUrl, documentId, qdrantCollectionName } = job.data;
        console.log(`Processing file job ${job.id} for document ${documentId} from URL: ${fileUrl}`);
        
        try {
          await Document.findByIdAndUpdate(documentId, { status: 'PROCESSING' });
          
          // --- NEW: Download the file from the URL ---
          console.log(`Downloading PDF from ${fileUrl}`);
          const response = await fetch(fileUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF from URL: ${fileUrl} with status ${response.statusText}`);
          }
          const blob = await response.blob();
          console.log("PDF downloaded successfully.");
          // --- END ---

          // Use the downloaded blob with PDFLoader
          const loader = new PDFLoader(blob);
          const docs = await loader.load();
          if (docs.length === 0) throw new Error('No content could be loaded from the downloaded PDF.');

          console.log(`Loaded ${docs.length} pages from PDF.`);

          await QdrantVectorStore.fromDocuments(docs, embeddings, {
            url: process.env.QDRANT_URL,
            apiKey: process.env.QDRANT_API_KEY,
            collectionName: qdrantCollectionName,
          });

          const completedDocument = await Document.findByIdAndUpdate(documentId, { status: 'COMPLETED' }, { new: true });
          
          await ChatRoom.create({
            userId: completedDocument.userId,
            documentId: completedDocument._id,
            title: completedDocument.fileName,
          });

          console.log(`File job ${job.id} completed. Chat room created.`);
          
        } catch (error) {
          console.error(`File job ${job.id} failed for document ${documentId}:`, error);
          await Document.findByIdAndUpdate(documentId, { status: 'FAILED' });
        }
        break;
      }

      case 'podcast-generation-job': {
        const { documentId, pdfPath: pdfUrl } = job.data; // The path is now a URL
        console.log(`Generating podcast job ${job.id} for document ${documentId}`);
        
        try {
          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'GENERATING' });

          // The aiService now also needs to handle a URL. We'll assume it's updated to do so.
          // For simplicity, we'll keep the service name the same.
          const script = await aiService.generateScriptFromPDF(pdfUrl); // Pass the URL to the service
          if (!script) throw new Error("Script generation failed.");

          const audioBuffer = await ttsService.textToAudioBuffer(script);
          if (!audioBuffer) throw new Error("TTS conversion failed.");

          const podcastUrl = await storageService.uploadAudio(audioBuffer, documentId);
          if (!podcastUrl) throw new Error("Audio upload failed.");

          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'COMPLETED', podcastUrl: podcastUrl });
          console.log(`Podcast job ${job.id} successful for document ${documentId}`);
          
          // We don't delete the original PDF from R2 yet, but we could add that later.
          // No local file to delete.
          
        } catch (error) {
          console.error(`Podcast job ${job.id} failed for document ${documentId}:`, error);
          await Document.findByIdAndUpdate(documentId, { podcastStatus: 'FAILED' });
        }
        break;
      }

      default:
        console.warn(`Worker received unknown job type: ${job.name}`);
    }
  },
  {
    connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT, 10), password: process.env.REDIS_PASSWORD, tls: {} },
    concurrency: 5,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  }
);

console.log('Worker is listening for jobs...');