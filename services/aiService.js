import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';

const model = new ChatGoogleGenerativeAI({
  model: 'gemini-1.5-flash-latest',
  temperature: 0.7, // A bit more creative for scripting
});

const generateScriptFromPDF = async (pdfPath) => {
  console.log("AI Service: Loading PDF for script generation...");
  const loader = new PDFLoader(pdfPath);
  const docs = await loader.load();
  const fullText = docs.map(doc => doc.pageContent).join('\n\n').substring(0, 10000); // Truncate to manage context size

  console.log("AI Service: Generating summary...");
  const summaryPrompt = `Summarize the key points and main arguments of the following text into a concise summary of about 300 words. Text: ${fullText}`;
  const summaryResult = await model.invoke(summaryPrompt);
  const summary = summaryResult.content;

  console.log("AI Service: Generating monologue script from summary...");
  const scriptPrompt = `You are a podcast host. Your task is to transform the following summary into a short, engaging, and easy-to-understand monologue of about 3-4 paragraphs. Write it in a natural, spoken style. The output should be a simple block of text, containing only the monologue. Summary: ${summary}`;
  const scriptResult = await model.invoke(scriptPrompt);
  
  return scriptResult.content;
};

export const aiService = {
  generateScriptFromPDF,
};