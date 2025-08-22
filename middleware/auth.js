// server/middleware/auth.js

import { Clerk } from '@clerk/clerk-sdk-node';
import User from '../models/user.model.js';

const clerkClient = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });

// This is a single, complete authentication and user-syncing middleware.
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Malformed authorization header' });
    }

    // Verify the token using Clerk's backend SDK
    const session = await clerkClient.verifyToken(token);
    if (!session || !session.sub) {
      return res.status(401).json({ error: 'Invalid token or session' });
    }

    const clerkUserId = session.sub;

    // Find the user in our local database
    let user = await User.findOne({ clerkUserId });

    // If the user doesn't exist, create them (first-time login)
    if (!user) {
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      const email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;

      user = await User.create({
        clerkUserId,
        email: email || 'No email provided',
      });
    }

    // Attach our internal user object (with MongoDB _id) to the request
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    // Send a generic 401 for all auth-related failures
    return res.status(401).json({ error: 'Authentication failed.' });
  }
};