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

const App = ({ initialConfig }: { initialConfig: any }) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<LLMProvider | null>(null);
  
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showProviderSelector, setShowProviderSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProviders] = useState(['ollama', 'gemini', 'anthropic']);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const COMMANDS = ['/models', '/provider', '/exit', '/quit'];

  useEffect(() => {
    if (input.startsWith('/')) {
      const filtered = COMMANDS.filter(cmd => cmd.startsWith(input) && cmd !== input);
      setSuggestions(filtered);
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  useEffect(() => {
    let provider: LLMProvider;
    if (initialConfig.defaultProvider === 'anthropic') {
      provider = new AnthropicProvider(initialConfig.anthropicKey, initialConfig.defaultModel);
    } else if (initialConfig.defaultProvider === 'gemini') {
      provider = new GeminiProvider(initialConfig.geminiKey, initialConfig.defaultModel);
    } else {
      provider = new OllamaProvider(initialConfig.defaultModel || 'llama3');
    }
    setCurrentProvider(provider);
  }, [initialConfig]);

  const handleCommand = async (cmd: string) => {
    if (cmd === '/models') {
      if (currentProvider) {
        const models = await currentProvider.listModels();
        setAvailableModels(models);
        setShowModelSelector(true);
        setSelectedIndex(0);
      }
      return true;
    }
    if (cmd === '/provider') {
      setShowProviderSelector(true);
      setSelectedIndex(0);
      return true;
    }
    if (cmd === '/exit' || cmd === '/quit') {
      exit();
      return true;
    }
    return false;
  };

  const handleSubmit = async (value: string) => {
    setInput('');
    if (await handleCommand(value)) return;

    const userMessage: LLMMessage = { role: 'user', content: value };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    if (currentProvider) {
      setIsStreaming(true);
      let assistantContent = '';
      const assistantMessage: LLMMessage = { role: 'assistant', content: '' };
      setMessages([...newMessages, assistantMessage]);

      try {
        for await (const chunk of currentProvider.streamResponse(newMessages)) {
          assistantContent += chunk;
          setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
        }
      } catch (error: any) {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${error.message}` }]);
      } finally {
        setIsStreaming(false);
      }
    }
  };

  useInput((input, key) => {
    if (suggestions.length > 0) {
      if (key.tab) {
        setInput(suggestions[selectedIndex]);
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(prev => Math.min(suggestions.length - 1, prev + 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
    }

    if (showModelSelector || showProviderSelector) {
      const list = showModelSelector ? availableModels : availableProviders;
      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      }
      if (key.downArrow) {
        setSelectedIndex(Math.min(list.length - 1, selectedIndex + 1));
      }
      if (key.return) {
        const selected = list[selectedIndex];
        if (showModelSelector) {
          (currentProvider as any).setModel?.(selected);
          saveConfig({ defaultModel: selected as string });
          setShowModelSelector(false);
        } else {
          const config = getConfig();
          let provider: LLMProvider;
          if (selected === 'anthropic' && config.anthropicKey) provider = new AnthropicProvider(config.anthropicKey);
          else if (selected === 'gemini' && config.geminiKey) provider = new GeminiProvider(config.geminiKey);
          else provider = new OllamaProvider();
          
          if (provider!) {
            setCurrentProvider(provider);
            saveConfig({ defaultProvider: selected as any });
          }
          setShowProviderSelector(false);
        }
      }
      if (key.escape) {
        setShowModelSelector(false);
        setShowProviderSelector(false);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>Dante Agent</Text>
        <Text dimColor> (Type /provider, /models, /exit)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {messages.map((m, i) => (
          <Box key={i} marginBottom={1}>
            <Text color={m.role === 'user' ? 'green' : 'magenta'} bold>
              {m.role === 'user' ? '❯ ' : 'Dante: '}
            </Text>
            <Text>{m.content}</Text>
          </Box>
        ))}
        {isStreaming && (
          <Box>
            <Text color="magenta">
              <Spinner type="dots" /> Thinking...
            </Text>
          </Box>
        )}
      </Box>

      {showModelSelector || showProviderSelector ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold>Select {showModelSelector ? 'Model' : 'Provider'}:</Text>
          {(showModelSelector ? availableModels : availableProviders).map((item, i) => (
            <Text key={item} color={i === selectedIndex ? 'yellow' : undefined as any}>
              {i === selectedIndex ? '● ' : '○ '} {item}
            </Text>
          ))}
          <Text dimColor>(↑/↓ to navigate, Enter to select, Esc to cancel)</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color="green" bold>❯ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
          {suggestions.length > 0 && (
            <Box flexDirection="column" marginTop={0} paddingX={1}>
              {suggestions.map((s, i) => (
                <Text key={s} color={i === selectedIndex ? 'cyan' : 'dim'}>
                  {i === selectedIndex ? '● ' : '  '} {s}
                </Text>
              ))}
              <Text dimColor italic size={1}>  (↑/↓ to navigate, Tab to complete)</Text>
            </Box>
          )}
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
