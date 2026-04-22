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
import { resolveSelfPromptResponse } from './loop/selfPrompt.js';

const COMMANDS = [
  { name: '/models',   desc: 'switch model' },
  { name: '/model',    desc: 'switch model (alias)' },
  { name: '/provider', desc: 'switch provider' },
  { name: '/providers',desc: 'switch provider (alias)' },
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
type PresentationMode = 'text' | 'diff';

type ChatMessage = {
  role: LLMMessage['role'];
  content: string;
  kind?: PresentationMode;
};

function toProviderMessages(messages: ChatMessage[]): LLMMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

type DiffSection = {
  title?: string;
  oldPath?: string;
  newPath?: string;
  lines: string[];
};

function parseDiffSections(content: string): DiffSection[] {
  const sections: DiffSection[] = [];
  const lines = content.split('\n');
  let current: DiffSection | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push(current);
      const parts = line.split(' ');
      current = {
        title: parts.slice(2).join(' '),
        lines: [line],
      };
      continue;
    }

    if (!current) {
      current = { lines: [] };
    }

    if (line.startsWith('--- ')) current.oldPath = line.slice(4).trim();
    if (line.startsWith('+++ ')) current.newPath = line.slice(4).trim();
    current.lines.push(line);
  }

  if (current) sections.push(current);
  return sections.length > 0 ? sections : [{ lines }];
}

function renderDiffSection(section: DiffSection, index: number) {
  const header = section.title || section.newPath || `patch ${index + 1}`;
  const visibleLines = section.lines.length > 36 ? section.lines.slice(0, 30) : section.lines;
  const isTruncated = section.lines.length > visibleLines.length;

  return (
    <Box key={index} flexDirection="column" paddingLeft={1} marginBottom={1}>
      <Text bold color="cyan">{header}</Text>
      <Box flexDirection="column" paddingLeft={1}>
        {(section.oldPath || section.newPath) && (
          <Box marginBottom={0}>
            {section.oldPath && <Text color="red">old: {section.oldPath}  </Text>}
            {section.newPath && <Text color="green">new: {section.newPath}</Text>}
          </Box>
        )}
        {visibleLines.map((line, lineIndex) => {
          const color = line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : line.startsWith('@') ? 'cyan' : line.startsWith('diff --git') ? 'yellow' : 'gray';
          return (
            <Text key={lineIndex} color={color} wrap="truncate">
              {line || ' '}
            </Text>
          );
        })}
        {isTruncated && <Text dimColor>  ... truncated patch output</Text>}
      </Box>
    </Box>
  );
}

function renderAssistantContent(message: ChatMessage) {
  if (message.kind !== 'diff') {
    return <Text wrap="wrap">{message.content}</Text>;
  }

  const sections = parseDiffSections(message.content);
  return (
    <Box flexDirection="column">
      {sections.map(renderDiffSection)}
    </Box>
  );
}

const App = ({ initialConfig }: { initialConfig: any }) => {
  const { exit } = useApp();
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [streamingStatus, setStreamingStatus] = useState('');
  const [currentProvider, setCurrentProvider] = useState<LLMProvider>(() => makeProvider(initialConfig));
  const [providerName, setProviderName] = useState<string>(initialConfig.defaultProvider || '');
  const [modelName, setModelName]       = useState<string>(initialConfig.defaultModel || '');

  const [mode, setMode]                       = useState<Mode>('chat');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProviders]                  = useState(['ollama', 'gemini', 'anthropic']);
  const [selectedIndex, setSelectedIndex]     = useState(0);
  const [suggestions, setSuggestions]         = useState<typeof COMMANDS>([]);

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
      setMessages(prev => [...prev, { role: 'assistant', content: text, kind: 'text' }]);
      return true;
    }
    if (cmd === '/exit' || cmd === '/quit') { exit(); return true; }

    if (cmd === '/models' || cmd === '/model') {
      const idx = availableModels.indexOf(modelName);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setMode('models');
      return true;
    }

    if (cmd === '/provider' || cmd === '/providers') {
      const idx = availableProviders.indexOf(providerName);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setMode('providers');
      return true;
    }

    return false;
  };

  const handleSubmit = async (value: string) => {
    let target = value.trim();
    if (suggestions.length > 0 && target.startsWith('/') && suggestions[selectedIndex]) {
      target = suggestions[selectedIndex]!.name;
    }

    setInput('');
    setSuggestions([]);
    if (!target) return;
    if (handleCommand(target)) return;

    const userMessage: ChatMessage = { role: 'user', content: target, kind: 'text' };
    const history = [...messages, userMessage];
    setMessages(history);
    setIsStreaming(true);
    setStreamingStatus('thinking...');
    try {
      const response = await resolveSelfPromptResponse(currentProvider, toProviderMessages(history), (status) => {
        setStreamingStatus(status);
      });
      
      // Typewriter effect
      let displayedContent = '';
      const fullContent = response.content;
      const assistantMessage: ChatMessage = { role: 'assistant', content: '', kind: response.kind };
      
      setMessages([...history, assistantMessage]);
      
      for (let i = 0; i < fullContent.length; i += 5) { // process 5 chars at a time for speed
        displayedContent += fullContent.slice(i, i + 5);
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = displayedContent;
          }
          return newMessages;
        });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (err: any) {
      setMessages([...history, { role: 'assistant', content: `error: ${err.message}`, kind: 'text' }]);
    } finally {
      setIsStreaming(false);
      setStreamingStatus('');
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
        if (!selected) return;
        if (mode === 'models') {
          (currentProvider as any).setModel?.(selected);
          saveConfig({ defaultModel: selected });
          setModelName(selected);
        } else {
          const cfg = getConfig();
          const p = makeProvider({ ...cfg, defaultProvider: selected as any });
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

    // ── Priority 3: suggestion autocomplete ───────────────────────────────────
    if (suggestions.length > 0 && mode === 'chat') {
      if (key.tab && suggestions[selectedIndex]) { setInput(suggestions[selectedIndex]!.name); return; }
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
              {m.role === 'user' ? 'you' : m.kind === 'diff' ? 'dante diff' : 'dante'}
            </Text>
            {m.role === 'assistant' ? renderAssistantContent(m) : <Text wrap="wrap">{m.content}</Text>}
          </Box>
        ))}
        {isStreaming && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="yellow" bold dimColor>dante</Text>
            <Box>
              <Text color="yellow"><Spinner type="dots" /></Text>
              <Text dimColor italic> {streamingStatus}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Input + inline dropdowns */}
      <Box flexDirection="column">
        {/* Suggestions appear below the input */}
        {/* Input row — only in chat mode */}
        {mode === 'chat' && (
          <Box>
            <Text color="green" bold>{'> '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              focus={true}
              placeholder="Ask dante anything..."
            />
          </Box>
        )}

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

        {/* Model dropdown */}
        {mode === 'models' && (
          <Box flexDirection="column" paddingLeft={0} marginTop={0}>
            <Text color="cyan" bold>  Select Model</Text>
            <Box flexDirection="column" paddingLeft={2}>
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
            <Text dimColor>  ↑↓ enter  esc cancel</Text>
          </Box>
        )}

        {/* Provider dropdown */}
        {mode === 'providers' && (
          <Box flexDirection="column" paddingLeft={0} marginTop={0}>
            <Text color="cyan" bold>  Select Provider</Text>
            <Box flexDirection="column" paddingLeft={2}>
              {availableProviders.map((p, i) => (
                <Box key={p}>
                  <Text color={i === selectedIndex ? 'cyan' : 'gray'} bold={i === selectedIndex}>
                    {i === selectedIndex ? '› ' : '  '}{p}
                  </Text>
                  {p === providerName && <Text color="green" dimColor>  ✓</Text>}
                </Box>
              ))}
            </Box>
            <Text dimColor>  ↑↓ enter  esc cancel</Text>
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
