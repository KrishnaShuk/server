// server/models/message.model.js
import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  chatRoomId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ChatRoom', 
    required: true 
  },
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: { 
    type: String, 
    required: true 
  },
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);
export default Message;