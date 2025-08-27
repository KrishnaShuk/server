// server/config/db.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env file

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connection SUCCESS');
  } catch (error) {
    console.error('MongoDB connection FAIL:', error);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;