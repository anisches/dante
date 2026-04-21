import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { getConfig, saveConfig } from './utils/config.js';
import type { LLMMessage, LLMProvider } from './providers/types.js';
import { GeminiProvider } from './providers/gemini.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';
import { runSetup } from './setup.js';

const COMMANDS = [
  { name: '/models',   desc: 'switch model' },
  { name: '/provider', desc: 'switch provider' },
  { name: '/clear',    desc: 'clear chat' },
  { name: '/help',     desc: 'show commands' },
  { name: '/exit',     desc: 'quit' },
];

function makeProvider(config: any): LLMProvider {
  if (config.defaultProvider === 'anthropic') {
    return new AnthropicProvider(config.anthropicKey, config.defaultModel);
  }
  if (config.defaultProvider === 'gemini') {
    return new GeminiProvider(config.geminiKey, config.defaultModel);
  }
  return new OllamaProvider(config.defaultModel || 'llama3');
}

const App = ({ initialConfig }: { initialConfig: any }) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<LLMProvider>(() => makeProvider(initialConfig));
  const [providerName, setProviderName] = useState<string>(initialConfig.defaultProvider || '');
  const [modelName, setModelName] = useState<string>(initialConfig.defaultModel || '');

  const [mode, setMode] = useState<'chat' | 'models' | 'providers'>('chat');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProviders] = useState(['ollama', 'gemini', 'anthropic']);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<typeof COMMANDS>([]);

  useEffect(() => {
    if (input.startsWith('/')) {
      setSuggestions(COMMANDS.filter(c => c.name.startsWith(input) && c.name !== input));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  const handleCommand = async (cmd: string): Promise<boolean> => {
    if (cmd === '/models') {
      const models = await currentProvider.listModels();
      setAvailableModels(models);
      setMode('models');
      setSelectedIndex(0);
      return true;
    }
    if (cmd === '/provider') {
      setMode('providers');
      setSelectedIndex(0);
      return true;
    }
    if (cmd === '/clear') {
      setMessages([]);
      return true;
    }
    if (cmd === '/help') {
      const help = COMMANDS.map(c => `  ${c.name.padEnd(12)}${c.desc}`).join('\n');
      setMessages(prev => [...prev, { role: 'assistant', content: help }]);
      return true;
    }
    if (cmd === '/exit' || cmd === '/quit') {
      exit();
      return true;
    }
    return false;
  };

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    setInput('');
    if (!trimmed) return;
    if (await handleCommand(trimmed)) return;

    const userMessage: LLMMessage = { role: 'user', content: trimmed };
    const history = [...messages, userMessage];
    setMessages(history);
    setIsStreaming(true);

    let content = '';
    setMessages([...history, { role: 'assistant', content: '' }]);

    try {
      for await (const chunk of currentProvider.streamResponse(history)) {
        content += chunk;
        setMessages([...history, { role: 'assistant', content }]);
      }
    } catch (err: any) {
      setMessages([...history, { role: 'assistant', content: `error: ${err.message}` }]);
    } finally {
      setIsStreaming(false);
    }
  };

  useInput((_ch, key) => {
    if (suggestions.length > 0 && mode === 'chat') {
      if (key.tab) { setInput(suggestions[selectedIndex].name); return; }
      if (key.downArrow) { setSelectedIndex(i => Math.min(suggestions.length - 1, i + 1)); return; }
      if (key.upArrow)   { setSelectedIndex(i => Math.max(0, i - 1)); return; }
    }

    if (mode === 'models' || mode === 'providers') {
      const list = mode === 'models' ? availableModels : availableProviders;
      if (key.upArrow)   { setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSelectedIndex(i => Math.min(list.length - 1, i + 1)); return; }
      if (key.escape)    { setMode('chat'); return; }
      if (key.return) {
        const selected = list[selectedIndex];
        if (mode === 'models') {
          (currentProvider as any).setModel?.(selected);
          saveConfig({ defaultModel: selected });
          setModelName(selected);
        } else {
          const cfg = getConfig();
          const p = makeProvider({ ...cfg, defaultProvider: selected });
          setCurrentProvider(p);
          setProviderName(selected);
          setModelName('');
          saveConfig({ defaultProvider: selected as any });
        }
        setMode('chat');
      }
    }
  });

  const statusRight = [providerName, modelName].filter(Boolean).join('  ·  ');

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>dante</Text>
        <Text dimColor>{statusRight}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {messages.map((m, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text color={m.role === 'user' ? 'green' : 'yellow'} bold dimColor>
              {m.role === 'user' ? 'you' : 'dante'}
            </Text>
            <Text wrap="wrap">{m.content}</Text>
          </Box>
        ))}
        {isStreaming && (
          <Box>
            <Text color="yellow" dimColor><Spinner type="dots" /></Text>
          </Box>
        )}
      </Box>

      {mode !== 'chat' ? (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>{mode === 'models' ? 'model' : 'provider'}</Text>
          {(mode === 'models' ? availableModels : availableProviders).map((item, i) => (
            <Box key={item}>
              <Text color={i === selectedIndex ? 'white' : 'gray'} bold={i === selectedIndex}>
                {i === selectedIndex ? '› ' : '  '}{item}
              </Text>
            </Box>
          ))}
          <Text dimColor>  ↑↓  enter  esc</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {suggestions.length > 0 && (
            <Box flexDirection="column" marginBottom={0} paddingX={2}>
              {suggestions.map((s, i) => (
                <Box key={s.name}>
                  <Text color={i === selectedIndex ? 'white' : 'gray'} bold={i === selectedIndex}>
                    {i === selectedIndex ? '› ' : '  '}{s.name}
                  </Text>
                  <Text dimColor>  {s.desc}</Text>
                </Box>
              ))}
              <Text dimColor>  tab complete  ↑↓ navigate</Text>
            </Box>
          )}
          <Box>
            <Text color="green" dimColor>{'> '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="send a message"
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

const start = async () => {
  const config = await runSetup();
  render(<App initialConfig={config} />);
};

start();
