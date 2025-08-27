// server/models/document.model.js
import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true }, // <-- ADDED
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    required: true,
  },
  qdrantCollectionName: { type: String, required: true, unique: true },

  // --- NEW PODCAST FIELDS ---
  podcastStatus: {
    type: String,
    enum: ['NONE', 'GENERATING', 'COMPLETED', 'FAILED'],
    default: 'NONE',
  },
  podcastUrl: {
    type: String,
    default: null,
  },
  // --- END ---

}, { timestamps: true });

const Document = mongoose.model('Document', documentSchema);
export default Document;