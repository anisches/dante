import type { LLMMessage, LLMProvider } from './types.js';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private model: string;
  private baseUrl: string;

  constructor(model: string = 'llama3') {
    this.model = model;
    this.baseUrl = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models?: { name: string }[] };
      return data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      return [];
    }
  }

  async generateResponse(messages: LLMMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
      }),
    });
    const data = await response.json() as { message: { content: string } };
    return data.message.content;
  }

  async *streamResponse(messages: LLMMessage[]): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
      }),
    });

    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch (e) {
          // Ignore parse errors for incomplete chunks
        }
      }
    }
  }

  setModel(model: string) {
    this.model = model;
  }
}
