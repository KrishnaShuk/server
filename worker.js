// server/worker.js

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { QdrantVectorStore } from '@langchain/qdrant';

import connectDB from './config/db.js';
import Document from './models/document.model.js';
import ChatRoom from './models/chatRoom.model.js';
import { promises as fs } from 'fs'; 

// Load environment variables
dotenv.config();

// Establish a database connection for the worker
connectDB();

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: 'embedding-001',
  apiKey: process.env.GOOGLE_API_KEY,
});

const worker = new Worker(
  'file-upload-queue', // Must match the queue name in index.js
  async (job) => {
    const { path, documentId, qdrantCollectionName } = job.data;
    console.log(`Processing job ${job.id} for document ${documentId}`);

    try {
      // 1. Update status to PROCESSING
      await Document.findByIdAndUpdate(documentId, { status: 'PROCESSING' });

      // 2. Load the PDF
      const loader = new PDFLoader(path);
      const docs = await loader.load();
      if (docs.length === 0) throw new Error('No content could be loaded from the PDF.');
      
      console.log(`Loaded ${docs.length} pages from PDF.`);

      // 3. Create and store embeddings in Qdrant
      await QdrantVectorStore.fromDocuments(docs, embeddings, {
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        collectionName: qdrantCollectionName,
      });

      console.log(`Embeddings stored in Qdrant collection: ${qdrantCollectionName}`);

      // 4. On success, update status to COMPLETED and create a chat room
      const completedDocument = await Document.findByIdAndUpdate(
        documentId,
        { status: 'COMPLETED' },
        { new: true } // Return the updated document
      );
      
      await ChatRoom.create({
        userId: completedDocument.userId,
        documentId: completedDocument._id,
        title: completedDocument.fileName,
      });

      console.log(`Job ${job.id} completed successfully. Chat room created.`);

      try {
        await fs.unlink(path);
        console.log(`Successfully deleted temporary file: ${path}`);
      } catch (cleanupError) {
        // If cleanup fails, we just log it. It's not a critical failure
        // of the job itself, as the main work (embeddings) is done.
        console.error(`Error during file cleanup for path ${path}:`, cleanupError);
      }

    } catch (error) {
      console.error(`Job ${job.id} failed for document ${documentId}:`, error);
      // On failure, update status to FAILED
      await Document.findByIdAndUpdate(documentId, { status: 'FAILED' });
    }
  },
  {
    // Connection details for BullMQ
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      tls: {},
    },
    concurrency: 5, // Process up to 5 jobs concurrently
    removeOnComplete: { count: 1000 }, // Keep logs for last 1000 jobs
    removeOnFail: { count: 5000 }, // Keep logs for last 5000 failed jobs
  }
);

console.log('Worker is listening for jobs...');