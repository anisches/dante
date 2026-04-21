export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMProvider {
  name: string;
  generateResponse(messages: LLMMessage[]): Promise<string>;
  streamResponse(messages: LLMMessage[]): AsyncGenerator<string>;
  listModels(): Promise<string[]>;
}
