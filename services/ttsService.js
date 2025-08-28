// server/services/ttsService.js
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

let client;

// This function initializes the TTS client by finding the correct credentials
const initializeClient = () => {
  // If the client is already initialized, don't do it again.
  if (client) {
    return client;
  }

  let credentials;
  
  // --- THIS IS THE SIMPLIFIED FIX ---

  // SCENARIO 1: The credentials JSON content is directly in an environment variable.
  // This is how Railway provides it.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("TTS Service: Found GOOGLE_APPLICATION_CREDENTIALS. Parsing credentials from variable.");
    credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  } 
  // SCENARIO 2: No credentials found
  else {
    // This is a clearer error. It tells the user exactly which variable to set.
    throw new Error("Could not find Google Cloud credentials. Please set the GOOGLE_APPLICATION_CREDENTIALS environment variable with the content of your service account key file.");
  }

  // Initialize the official client with the loaded credentials.
  client = new TextToSpeechClient({
    credentials,
    projectId: credentials.project_id,
  });

  return client;
};

const textToAudioBuffer = async (text) => {
  const ttsClient = initializeClient(); // This line ensures the client is ready
  console.log("TTS Service: Converting text to audio...");
  const request = {
    input: { text: text },
    voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await ttsClient.synthesizeSpeech(request);
  console.log("TTS Service: Audio buffer received.");
  return response.audioContent;
};

export const ttsService = {
  textToAudioBuffer,
};