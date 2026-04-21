import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.dante');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  anthropicKey?: string;
  geminiKey?: string;
  defaultProvider?: 'anthropic' | 'gemini' | 'ollama';
  defaultModel?: string;
}

export function getConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading config file:', error);
    return {};
  }
}

export function saveConfig(config: Partial<Config>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.chmodSync(CONFIG_DIR, 0o700);
  }

  const currentConfig = getConfig();
  const newConfig = { ...currentConfig, ...config };

  // Remove keys with undefined values
  Object.keys(newConfig).forEach(key => {
    if (newConfig[key as keyof Config] === undefined) {
      delete newConfig[key as keyof Config];
    }
  });

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), {
    mode: 0o600,
  });
}
