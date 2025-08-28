// server/index.js

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import expand from 'dotenv-expand';
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
  const myEnv = dotenv.config();
expand.expand(myEnv);
  await connectDB();

  const app = express();

  // --- Middleware Setup ---
  const corsOptions = { origin: process.env.CLIENT_URL, optionsSuccessStatus: 200 };
  app.use(cors(corsOptions));
  app.use(express.json());

  // --- Multer Setup for file uploads ---
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
  });
  const upload = multer({ storage: storage });

  // --- BullMQ Queue Setup for background jobs ---
  const queue = new Queue('file-upload-queue', {
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      tls: {},
    },
  });

  // ========== API ENDPOINTS ==========

  // --- 1. PDF Upload Endpoint ---
  app.post('/upload/pdf', authenticate, upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
      const { originalname, path } = req.file;
      const newDocument = await Document.create({
        userId: req.user._id,
        fileName: originalname,
        filePath: path, // Save the file path to the database
        status: 'PENDING',
        qdrantCollectionName: new mongoose.Types.ObjectId().toHexString(),
      });
      await queue.add('file-processing-job', {
        path,
        documentId: newDocument._id,
        qdrantCollectionName: newDocument.qdrantCollectionName,
      });
      console.log(`Job added to queue for document: ${newDocument._id}`);
      return res.status(201).json({ message: 'File uploaded and queued for processing.', documentId: newDocument._id });
    } catch (error) {
      console.error('Error during file upload:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  // --- 2. Get All Chat Rooms Endpoint ---
  app.get('/chatrooms', authenticate, async (req, res) => {
    try {
      const chatRooms = await ChatRoom.find({ userId: req.user._id }).sort({ createdAt: -1 });
      res.status(200).json(chatRooms);
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- 3. Get Messages for a Chat Room Endpoint ---
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

  // --- 4. Post a New Message Endpoint ---
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
  
  // --- 5. Get Document Processing Status Endpoint ---
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

  // --- 6. Start Podcast Generation Endpoint ---
  app.post('/documents/:documentId/podcast', authenticate, async (req, res) => {
    try {
      const document = await Document.findOne({ _id: req.params.documentId, userId: req.user._id });
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      if (document.podcastStatus === 'GENERATING' || document.podcastStatus === 'COMPLETED') {
      return res.status(409).json({ // 409 Conflict is a good status code here
        message: 'A podcast is already being generated or has been completed for this document.',
        status: document.podcastStatus,
        url: document.podcastUrl,
      });
    }
      if (!document.filePath) return res.status(400).json({ error: 'Document file path not found.' });
      
      await queue.add('podcast-generation-job', {
        documentId: document._id,
        pdfPath: document.filePath,
      });
      res.status(202).json({ message: 'Podcast generation has been started.' });
    } catch (error) {
      console.error('Error starting podcast generation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- 7. Get Podcast Generation Status Endpoint ---
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

  // --- Start the Server ---
  const PORT = process.env.PORT || 8001;
  app.listen(PORT, () => console.log(`Server started on PORT: ${PORT}`));
};

startServer();