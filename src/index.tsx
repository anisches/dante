import React, { useState, useEffect, useRef } from 'react';
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
  if (config.defaultProvider === 'anthropic') return new AnthropicProvider(config.anthropicKey, config.defaultModel);
  if (config.defaultProvider === 'gemini')    return new GeminiProvider(config.geminiKey, config.defaultModel);
  return new OllamaProvider(config.defaultModel || 'llama3');
}

type Mode = 'chat' | 'models' | 'providers';

const App = ({ initialConfig }: { initialConfig: any }) => {
  const { exit } = useApp();
  const [messages, setMessages]         = useState<LLMMessage[]>([]);
  const [input, setInput]               = useState('');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [currentProvider, setCurrentProvider] = useState<LLMProvider>(() => makeProvider(initialConfig));
  const [providerName, setProviderName] = useState<string>(initialConfig.defaultProvider || '');
  const [modelName, setModelName]       = useState<string>(initialConfig.defaultModel || '');

  const [mode, setMode]                       = useState<Mode>('chat');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProviders]                  = useState(['ollama', 'gemini', 'anthropic']);
  const [selectedIndex, setSelectedIndex]     = useState(0);
  const [suggestions, setSuggestions]         = useState<typeof COMMANDS>([]);

  const intercepted = useRef(false);

  // Pre-fetch models whenever provider changes
  useEffect(() => {
    let cancelled = false;
    currentProvider.listModels()
      .then(m  => { if (!cancelled) setAvailableModels(m); })
      .catch(() => { if (!cancelled) setAvailableModels([]); });
    return () => { cancelled = true; };
  }, [currentProvider]);

  // Suggestion list while typing a slash command
  useEffect(() => {
    if (input.startsWith('/')) {
      setSuggestions(COMMANDS.filter(c => c.name.startsWith(input) && c.name !== input));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  // Only handles non-selector commands — fully synchronous, never touches the LLM
  const handleCommand = (cmd: string): boolean => {
    if (cmd === '/clear') { setMessages([]); return true; }
    if (cmd === '/help') {
      const text = COMMANDS.map(c => `  ${c.name.padEnd(12)}${c.desc}`).join('\n');
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      return true;
    }
    if (cmd === '/exit' || cmd === '/quit') { exit(); return true; }
    return false;
  };

  const handleSubmit = async (value: string) => {
    // /models and /provider are fully handled in useInput — bail if they sneak through
    if (intercepted.current) { intercepted.current = false; return; }
    const trimmed = value.trim();
    setInput('');
    if (!trimmed) return;
    if (handleCommand(trimmed)) return;

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
    // ── Priority 1: selector is open — own all keys ──────────────────────────
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
        return;
      }
      return; // swallow everything else while selector is open
    }

    // ── Priority 2: Enter on a selector command — intercept before TextInput ──
    if (key.return && mode === 'chat') {
      const trimmed = input.trim();
      if (trimmed === '/models') {
        intercepted.current = true;
        setInput('');
        setSuggestions([]);
        const idx = availableModels.indexOf(modelName);
        setSelectedIndex(idx >= 0 ? idx : 0);
        setMode('models');
        return;
      }
      if (trimmed === '/provider') {
        intercepted.current = true;
        setInput('');
        setSuggestions([]);
        const idx = availableProviders.indexOf(providerName);
        setSelectedIndex(idx >= 0 ? idx : 0);
        setMode('providers');
        return;
      }
    }

    // ── Priority 3: suggestion autocomplete ───────────────────────────────────
    if (suggestions.length > 0 && mode === 'chat') {
      if (key.tab)       { setInput(suggestions[selectedIndex].name); return; }
      if (key.downArrow) { setSelectedIndex(i => Math.min(suggestions.length - 1, i + 1)); return; }
      if (key.upArrow)   { setSelectedIndex(i => Math.max(0, i - 1)); return; }
    }
  });

  const statusRight = [providerName, modelName].filter(Boolean).join('  ·  ');

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>dante</Text>
        <Text dimColor>{statusRight}</Text>
      </Box>

      {/* Message history */}
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
          <Box marginBottom={1}>
            <Text color="yellow" dimColor><Spinner type="dots" /></Text>
          </Box>
        )}
      </Box>

      {/* Input + inline dropdowns */}
      <Box flexDirection="column">
        {/* Suggestions appear above the input */}
        {suggestions.length > 0 && mode === 'chat' && (
          <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
            {suggestions.map((s, i) => (
              <Box key={s.name}>
                <Text color={i === selectedIndex ? 'white' : 'gray'} bold={i === selectedIndex}>
                  {i === selectedIndex ? '› ' : '  '}{s.name}
                </Text>
                <Text dimColor>  {s.desc}</Text>
              </Box>
            ))}
            <Text dimColor>  tab  ↑↓</Text>
          </Box>
        )}

        {/* Input row — always visible */}
        <Box>
          <Text color="green" dimColor>{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            focus={mode === 'chat'}
            placeholder="send a message"
          />
        </Box>

        {/* Model dropdown — inline below input */}
        {mode === 'models' && (
          <Box flexDirection="column" paddingLeft={2} marginTop={0}>
            <Text dimColor>── model  ↑↓ enter  esc cancel ──</Text>
            {availableModels.length === 0
              ? <Text dimColor>  no models found</Text>
              : availableModels.map((m, i) => (
                <Box key={m}>
                  <Text color={i === selectedIndex ? 'cyan' : 'gray'} bold={i === selectedIndex}>
                    {i === selectedIndex ? '› ' : '  '}{m}
                  </Text>
                  {m === modelName && <Text color="green" dimColor>  ✓</Text>}
                </Box>
              ))
            }
          </Box>
        )}

        {/* Provider dropdown — inline below input */}
        {mode === 'providers' && (
          <Box flexDirection="column" paddingLeft={2} marginTop={0}>
            <Text dimColor>── provider  ↑↓ enter  esc cancel ──</Text>
            {availableProviders.map((p, i) => (
              <Box key={p}>
                <Text color={i === selectedIndex ? 'cyan' : 'gray'} bold={i === selectedIndex}>
                  {i === selectedIndex ? '› ' : '  '}{p}
                </Text>
                {p === providerName && <Text color="green" dimColor>  ✓</Text>}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const start = async () => {
  const config = await runSetup();
  render(<App initialConfig={config} />);
};

start();
