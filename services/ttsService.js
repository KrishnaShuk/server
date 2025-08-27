// server/services/ttsService.js
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import fs from 'fs';
import path from 'path';

// --- NEW: Explicit Credential Loading ---
const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
if (!fs.existsSync(credentialsPath)) {
  throw new Error(`Google Cloud credentials file not found at path: ${credentialsPath}`);
}
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
// --- END ---

// --- UPDATE: Initialize client with credentials ---
const client = new TextToSpeechClient({
  credentials,
  projectId: credentials.project_id, // Also explicitly set the project ID
});
// --- END ---

const textToAudioBuffer = async (text) => {
  console.log("TTS Service: Converting text to audio...");
  const request = {
    input: { text: text },
    voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  console.log("TTS Service: Audio buffer received.");
  return response.audioContent;
};

export const ttsService = {
  textToAudioBuffer,
};