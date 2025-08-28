// server/index.js

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { S3Client } from '@aws-sdk/client-s3'; // For R2 Cloud Storage
import multerS3 from 'multer-s3';             // Multer's S3 storage engine
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Local Imports
import connectDB from './config/db.js';
import { authenticate } from './middleware/auth.js';
import Document from './models/document.model.js';
import ChatRoom from './models/chatRoom.model.js';
import Message from './models/message.model.js';

// LangChain & AI Imports
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { QdrantVectorStore } from '@langchain/qdrant';

const startServer = async () => {
  dotenv.config();
  await connectDB();

  const app = express();

  const corsOptions = { origin: process.env.CLIENT_URL, optionsSuccessStatus: 200 };
  app.use(cors(corsOptions));
  app.use(express.json());

  // --- NEW: CONFIGURE S3 CLIENT FOR CLOUDFLARE R2 ---
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  // --- NEW: CONFIGURE MULTER TO UPLOAD DIRECTLY TO R2 ---
  const upload = multer({
    storage: multerS3({
      s3: s3,
      bucket: process.env.R2_BUCKET_NAME,
      acl: 'public-read', // Make the uploaded file publicly accessible for the worker
      key: function (req, file, cb) {
        // Create a unique filename for the object in the R2 bucket
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        // Store original uploads in a dedicated "uploads" folder within the bucket
        cb(null, `uploads/${uniqueSuffix}-${file.originalname}`);
      }
    })
  });

  const queue = new Queue('file-upload-queue', {
    connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT, 10), password: process.env.REDIS_PASSWORD, tls: {} },
  });

  // ========== API ENDPOINTS ==========

  // --- UPDATED UPLOAD ENDPOINT ---
  app.post('/upload/pdf', authenticate, upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
      
      const { originalname, location } = req.file;
      
      const newDocument = await Document.create({
        userId: req.user._id,
        fileName: originalname,
        filePath: location, // Save the public R2 URL
        status: 'PENDING',
        qdrantCollectionName: new mongoose.Types.ObjectId().toHexString(),
      });
      
      await queue.add('file-processing-job', {
        path: location, // Pass the public URL to the worker
        documentId: newDocument._id,
        qdrantCollectionName: newDocument.qdrantCollectionName,
      });
      
      console.log(`Job added for document ${newDocument._id} from URL ${location}`);
      return res.status(201).json({ documentId: newDocument._id });
    } catch (error) {
      console.error('Error during file upload:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  // --- Get All Chat Rooms Endpoint ---
  app.get('/chatrooms', authenticate, async (req, res) => {
    try {
      const chatRooms = await ChatRoom.find({ userId: req.user._id }).sort({ createdAt: -1 });
      res.status(200).json(chatRooms);
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Get Messages for a Chat Room Endpoint ---
  app.get('/chatrooms/:chatRoomId/messages', authenticate, async (req, res) => {
    try {
      const chatRoom = await ChatRoom.findOne({ _id: req.params.chatRoomId, userId: req.user._id });
      if (!chatRoom) return res.status(404).json({ error: 'Chat room not found or you do not have permission.' });
      const messages = await Message.find({ chatRoomId: req.params.chatRoomId }).sort({ createdAt: 1 });
      res.status(200).json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Post a New Message Endpoint ---
  app.post('/chatrooms/:chatRoomId/messages', authenticate, async (req, res) => {
    try {
      const { message: userMessage } = req.body;
      if (!userMessage) return res.status(400).json({ error: 'Message content is required.' });

      const chatRoom = await ChatRoom.findOne({ _id: req.params.chatRoomId, userId: req.user._id }).populate('documentId');
      if (!chatRoom || !chatRoom.documentId) return res.status(404).json({ error: 'Chat room or associated document not found.' });
      
      await Message.create({ chatRoomId: req.params.chatRoomId, role: 'user', content: userMessage });
      
      const document = chatRoom.documentId;
      const embeddings = new GoogleGenerativeAIEmbeddings({ model: 'embedding-001' });
      const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, collectionName: document.qdrantCollectionName });
      const retriever = vectorStore.asRetriever(4);
      const contextDocs = await retriever.invoke(userMessage);
      const context = contextDocs.map(doc => doc.pageContent).join('\n\n---\n\n');
      
      const model = new ChatGoogleGenerativeAI({ model: 'gemini-1.5-flash-latest', temperature: 0.2 });
      const prompt = `You are an expert AI assistant. Your task is to answer the user's question based *only* on the provided context from a PDF document. If the answer is not found in the context, you MUST say "I could not find the answer in the provided document." Do not use your general knowledge. CONTEXT: ${context} USER'S QUESTION: ${userMessage}`;
      const aiResponse = await model.invoke(prompt);
      const newAiMessage = await Message.create({ chatRoomId: req.params.chatRoomId, role: 'assistant', content: aiResponse.content });
      
      res.status(201).json(newAiMessage);
    } catch (error) {
      console.error('Error processing chat message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Get Document Status Endpoint (for Polling) ---
  app.get('/documents/:documentId/status', authenticate, async (req, res) => {
    try {
      const document = await Document.findOne({ _id: req.params.documentId, userId: req.user._id });
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      res.status(200).json({ status: document.status });
    } catch (error) {
      console.error('Error fetching document status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Podcast Endpoints ---
  app.post('/documents/:documentId/podcast', authenticate, async (req, res) => {
    try {
      const document = await Document.findOne({ _id: req.params.documentId, userId: req.user._id });
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      if (!document.filePath) return res.status(400).json({ error: 'Document file path not found.' });
      
      await queue.add('podcast-generation-job', {
        documentId: document._id,
        pdfPath: document.filePath, // Use the stored public R2 URL
      });

      res.status(202).json({ message: 'Podcast generation has been started.' });
    } catch (error) {
      console.error('Error starting podcast generation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/documents/:documentId/podcast/status', authenticate, async (req, res) => {
    try {
      const document = await Document.findOne({ _id: req.params.documentId, userId: req.user._id });
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      
      res.status(200).json({
        status: document.podcastStatus,
        url: document.podcastUrl,
      });
    } catch (error) {
      console.error('Error fetching podcast status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Server Start ---
  const PORT = process.env.PORT || 8001;
  app.listen(PORT, () => console.log(`Server started on PORT: ${PORT}`));
};

startServer();