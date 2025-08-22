// server/models/chatRoom.model.js
import mongoose from 'mongoose';

const chatRoomSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
 },
  documentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Document', 
    required: true 
 },
  title: { 
    type: String, 
    required: true 
},
}, { timestamps: true });

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
export default ChatRoom;