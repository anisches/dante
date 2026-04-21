import Anthropic from '@anthropic-ai/sdk';
import type { LLMMessage, LLMProvider } from './types.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20240620') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async listModels(): Promise<string[]> {
    return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
  }

  async generateResponse(messages: LLMMessage[]): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });
    return (response.content[0] as any).text;
  }

  async *streamResponse(messages: LLMMessage[]): AsyncGenerator<string> {
    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && (chunk.delta as any).text) {
        yield (chunk.delta as any).text;
      }
    }
  }

  setModel(model: string) {
    this.model = model;
  }
}
