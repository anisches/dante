import * as p from '@clack/prompts';
import { getConfig, saveConfig } from './utils/config.js';
import { OllamaProvider } from './providers/ollama.js';

export async function runSetup() {
  const config = getConfig();

  if (config.defaultProvider && 
      (config.defaultProvider === 'ollama' || 
       (config.defaultProvider === 'gemini' && config.geminiKey) || 
       (config.defaultProvider === 'anthropic' && config.anthropicKey))) {
    return config;
  }

  p.intro('Welcome to Dante Agent');

  const provider = await p.select({
    message: 'Select your default LLM provider:',
    options: [
      { value: 'ollama', label: 'Ollama (Local)' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'anthropic', label: 'Anthropic Claude' },
    ],
  });

  if (p.isCancel(provider)) {
    p.outro('Setup cancelled');
    process.exit(0);
  }

  const updates: any = { defaultProvider: provider };

  if (provider === 'gemini') {
    const key = await p.password({
      message: 'Enter your Gemini API Key:',
      validate: (value) => (value.length === 0 ? 'Key is required' : undefined),
    });
    if (p.isCancel(key)) process.exit(0);
    updates.geminiKey = key;
  } else if (provider === 'anthropic') {
    const key = await p.password({
      message: 'Enter your Anthropic API Key:',
      validate: (value) => (value.length === 0 ? 'Key is required' : undefined),
    });
    if (p.isCancel(key)) process.exit(0);
    updates.anthropicKey = key;
  }

  if (provider === 'ollama') {
    const s = p.spinner();
    s.start('Fetching Ollama models...');
    const ollama = new OllamaProvider();
    const models = await ollama.listModels();
    s.stop('Models fetched');

    if (models.length > 0) {
      const model = await p.select({
        message: 'Select a default model:',
        options: models.map(m => ({ value: m, label: m })),
      });
      if (!p.isCancel(model)) {
        updates.defaultModel = model;
      }
    } else {
      p.note('No Ollama models found. Make sure Ollama is running.', 'Warning');
    }
  }

  saveConfig(updates);
  p.outro('Setup complete!');
  
  return getConfig();
}
