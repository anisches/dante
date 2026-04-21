import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMMessage, LLMProvider } from './types.js';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async listModels(): Promise<string[]> {
    return ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];
  }

  async generateResponse(messages: LLMMessage[]): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.generateContent(messages.map(m => m.content).join('\n'));
    return result.response.text();
  }

  async *streamResponse(messages: LLMMessage[]): AsyncGenerator<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.generateContentStream(messages.map(m => m.content).join('\n'));
    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }

  setModel(model: string) {
    this.model = model;
  }
}
