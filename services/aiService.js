// server/services/aiService.js
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';

const model = new ChatGoogleGenerativeAI({
  model: 'gemini-1.5-flash-latest',
  temperature: 0.7,
});

// UPDATED to accept a URL
const generateScriptFromPDF = async (pdfUrl) => {
  console.log(`AI Service: Loading PDF for script generation from URL: ${pdfUrl}`);
  
  // Download the file from the URL into a blob
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF from URL: ${pdfUrl}`);
  }
  const blob = await response.blob();
  
  // Use the blob with PDFLoader
  const loader = new PDFLoader(blob);
  const docs = await loader.load();
  const fullText = docs.map(doc => doc.pageContent).join('\n\n').substring(0, 10000);

  console.log("AI Service: Generating summary...");
  const summaryPrompt = `Summarize the key points of the following text into a concise summary of about 300 words. Text: ${fullText}`;
  const summaryResult = await model.invoke(summaryPrompt);
  const summary = summaryResult.content;

  console.log("AI Service: Generating monologue script from summary...");
  const scriptPrompt = `You are a podcast host. Transform the following summary into a short, engaging monologue. Write in a natural, spoken style. Output only the monologue text. Summary: ${summary}`;
  const scriptResult = await model.invoke(scriptPrompt);
  
  return scriptResult.content;
};

export const aiService = {
  generateScriptFromPDF,
};