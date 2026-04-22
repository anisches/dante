import type { LLMMessage, LLMProvider } from '../providers/types.js';

type LoopMode = 'answer' | 'action';
type PresentationMode = 'text' | 'diff';

interface AnalysisPlan {
  mode: LoopMode;
  presentation: PresentationMode;
  whatItIs: string;
  whatItIsNot: string;
  needsAction: boolean;
  keyEntities: string[];
  successCriteria: string[];
  constraints: string[];
  recommendedNextStep: string;
}

interface FreshnessCheck {
  requiresFreshVerification: boolean;
  timeSensitiveClaims: string[];
  safeToUseLatestLanguage: boolean;
  rewriteGuidance: string;
}

interface FinalResponse {
  kind: PresentationMode;
  content: string;
}

interface RetrievalQueryPlan {
  queries: string[];
}

interface RetrievedSource {
  query: string;
  title: string;
  url: string;
  snippet: string;
}

const DANTE_PERSONA = `You are Dante, the Doer. You are a high-performance agent that prioritizes execution over explanation.
- Your tone is professional, technical, and authoritative.
- You take direct responsibility for your answers and actions.`;

const MONITOR_PERSONA = `You are the Cohesion Monitor. Your role is to oversee Dante's execution.
- You identify strategic risks, inconsistencies, and alignment issues.
- You provide brief, sharp suggestions to ensure the final output is cohesive and accurate.
- You do not write the answer yourself; you guide the Doer.`;

const ANALYZE_PROMPT = `${DANTE_PERSONA}

Analyze the latest user request and return strict JSON only.

Schema:
{
  "mode": "answer" | "action",
  "presentation": "text" | "diff",
  "whatItIs": "short summary of the request",
  "whatItIsNot": "important exclusions or assumptions",
  "needsAction": true | false,
  "keyEntities": ["..."],
  "successCriteria": ["..."],
  "constraints": ["..."],
  "recommendedNextStep": "the best immediate next step"
}

Rules:
- "answer" means the request is mainly informational and should be answered directly.
- "action" means the request benefits from comparing approaches, ranking them, or planning execution.
- "diff" presentation means the user is asking for code changes, patches, fixes, or implementation output.
- "text" presentation means a plain prose answer is better.
- Keep every value concise.
- Return valid JSON only. No markdown, no commentary.`;

const RETRIEVAL_PROMPT = `Generate web search queries for live retrieval and return strict JSON only.

Schema:
{
  "queries": ["..."]
}

Rules:
- Produce 1 to 3 queries.
- Each query should be concise and targeted at live evidence or official sources.
- Prefer keywords from the user request and any time-sensitive entities.
- Return valid JSON only. No markdown, no commentary.`;

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

function parseAnalysis(raw: string): AnalysisPlan {
  const fallback: AnalysisPlan = {
    mode: 'answer',
    presentation: 'text',
    whatItIs: 'A user request that should be answered directly.',
    whatItIsNot: 'Not a request that obviously needs planning or execution.',
    needsAction: false,
    keyEntities: [],
    successCriteria: [],
    constraints: [],
    recommendedNextStep: 'Answer the question clearly and concisely.',
  };

  const json = extractJson(raw);
  if (!json) return fallback;

  try {
    const parsed = JSON.parse(json) as Partial<AnalysisPlan> & { mode?: string; needsAction?: unknown };
    const mode: LoopMode = parsed.mode === 'action' ? 'action' : 'answer';
    const presentation: PresentationMode = parsed.presentation === 'diff' ? 'diff' : 'text';
    return {
      mode,
      presentation,
      whatItIs: typeof parsed.whatItIs === 'string' ? parsed.whatItIs : fallback.whatItIs,
      whatItIsNot: typeof parsed.whatItIsNot === 'string' ? parsed.whatItIsNot : fallback.whatItIsNot,
      needsAction: typeof parsed.needsAction === 'boolean' ? parsed.needsAction : mode === 'action',
      keyEntities: Array.isArray(parsed.keyEntities) ? parsed.keyEntities.filter((item): item is string => typeof item === 'string') : [],
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.filter((item): item is string => typeof item === 'string') : [],
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints.filter((item): item is string => typeof item === 'string') : [],
      recommendedNextStep: typeof parsed.recommendedNextStep === 'string' ? parsed.recommendedNextStep : fallback.recommendedNextStep,
    };
  } catch {
    return fallback;
  }
}

function parseFreshness(raw: string): FreshnessCheck {
  const fallback: FreshnessCheck = {
    requiresFreshVerification: false,
    timeSensitiveClaims: [],
    safeToUseLatestLanguage: false,
    rewriteGuidance: 'Avoid unstated recency claims and keep the wording general.',
  };

  const json = extractJson(raw);
  if (!json) return fallback;

  try {
    const parsed = JSON.parse(json) as Partial<FreshnessCheck>;
    return {
      requiresFreshVerification: typeof parsed.requiresFreshVerification === 'boolean' ? parsed.requiresFreshVerification : fallback.requiresFreshVerification,
      timeSensitiveClaims: Array.isArray(parsed.timeSensitiveClaims) ? parsed.timeSensitiveClaims.filter((item): item is string => typeof item === 'string') : [],
      safeToUseLatestLanguage: typeof parsed.safeToUseLatestLanguage === 'boolean' ? parsed.safeToUseLatestLanguage : fallback.safeToUseLatestLanguage,
      rewriteGuidance: typeof parsed.rewriteGuidance === 'string' ? parsed.rewriteGuidance : fallback.rewriteGuidance,
    };
  } catch {
    return fallback;
  }
}

function parseRetrievalQueries(raw: string): RetrievalQueryPlan {
  const fallback: RetrievalQueryPlan = { queries: [] };
  const json = extractJson(raw);
  if (!json) return fallback;

  try {
    const parsed = JSON.parse(json) as Partial<RetrievalQueryPlan>;
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [];
    return { queries: queries.slice(0, 3) };
  } catch {
    return fallback;
  }
}

function buildAnalysisContext(plan: AnalysisPlan): string {
  return [
    `mode: ${plan.mode}`,
    `presentation: ${plan.presentation}`,
    `whatItIs: ${plan.whatItIs}`,
    `whatItIsNot: ${plan.whatItIsNot}`,
    `needsAction: ${String(plan.needsAction)}`,
    `keyEntities: ${plan.keyEntities.length > 0 ? plan.keyEntities.join(', ') : 'none'}`,
    `successCriteria: ${plan.successCriteria.length > 0 ? plan.successCriteria.join(', ') : 'none'}`,
    `constraints: ${plan.constraints.length > 0 ? plan.constraints.join(', ') : 'none'}`,
    `recommendedNextStep: ${plan.recommendedNextStep}`,
  ].join('\n');
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(href: string): string {
  try {
    const url = new URL(href, 'https://html.duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

function fallbackRetrievalQueries(plan: AnalysisPlan, userPrompt: string): string[] {
  const seeds = [
    userPrompt,
    plan.keyEntities.length > 0 ? plan.keyEntities.join(' ') : '',
    `${plan.whatItIs} official`,
  ];

  return seeds
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildRetrievalContext(sources: RetrievedSource[]): string {
  if (sources.length === 0) {
    return 'No live sources were retrieved.';
  }

  return sources
    .map((source, index) => [
      `Source ${index + 1}`,
      `Query: ${source.query}`,
      `Title: ${source.title}`,
      `URL: ${source.url}`,
      `Snippet: ${source.snippet}`,
    ].join('\n'))
    .join('\n\n');
}

async function webSearch(query: string): Promise<RetrievedSource[]> {
  const endpoint = 'https://html.duckduckgo.com/html/';
  const body = new URLSearchParams({ q: query, kl: 'us-en' });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
    body,
  });

  if (!response.ok) return [];
  const html = await response.text();
  const results: RetrievedSource[] = [];
  const resultBlocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) ?? [];

  for (const block of resultBlocks) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[\s\S]*?>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const title = stripHtml(titleMatch[2] ?? '');
    const url = normalizeUrl(titleMatch[1] ?? '');
    const snippet = stripHtml(snippetMatch?.[1] ?? '');
    if (!title || !url) continue;
    results.push({ query: '', title, url, snippet });
    if (results.length >= 5) break;
  }

  return results;
}

async function retrieveSources(provider: LLMProvider, plan: AnalysisPlan, userPrompt: string, draft: string, monitorSuggestions: string): Promise<RetrievedSource[]> {
  const queryPlanRaw = await provider.generateResponse([
    { role: 'user', content: RETRIEVAL_PROMPT },
    {
      role: 'user',
      content: [
        `User request: ${userPrompt}`,
        `Analysis: ${buildAnalysisContext(plan)}`,
        `Draft: ${draft}`,
        `Monitor Suggestions: ${monitorSuggestions}`,
      ].join('\n'),
    },
  ]);

  const queryPlan = parseRetrievalQueries(queryPlanRaw);
  const queries = queryPlan.queries.length > 0 ? queryPlan.queries : fallbackRetrievalQueries(plan, userPrompt);
  const seen = new Set<string>();
  const sources: RetrievedSource[] = [];

  for (const query of queries) {
    let results: RetrievedSource[] = [];
    try {
      results = await webSearch(query);
    } catch {
      results = [];
    }

    for (const result of results) {
      const urlKey = result.url.toLowerCase();
      if (seen.has(urlKey)) continue;
      seen.add(urlKey);
      sources.push({ ...result, query });
      if (sources.length >= 6) return sources;
    }
  }

  return sources;
}

function buildMonitorPrompt(plan: AnalysisPlan, draft: string): string {
  return `${MONITOR_PERSONA}

Review the Doer's Draft against the Strategic Plan.

Strategic Plan:
${buildAnalysisContext(plan)}

Doer's Draft:
${draft}

Identify any cohesion gaps, missing constraints, or technical risks.
Return your suggestions as a concise list. If no changes are needed, respond with "STAY_COURSE".`;
}

function buildDraftPrompt(plan: AnalysisPlan, userPrompt: string): string {
  if (plan.mode === 'answer') {
    return `${DANTE_PERSONA}

You are in answer mode.

User request:
${userPrompt}

Analysis:
${buildAnalysisContext(plan)}

Write a precise answer.
Requirements:
- Be direct and compact.
- Do not explain your reasoning or mention the analysis phase.
- If presentation is diff, provide ONLY the code changes.
- End with one short, high-value validation question if needed.`;
  }

  return `${DANTE_PERSONA}

You are in action mode.

User request:
${userPrompt}

Analysis:
${buildAnalysisContext(plan)}

Perform the self-prompt loop internally:
1. Generate up to 4 candidate approaches.
2. Simulate each approach and compare their effectiveness.
3. Synthesize the most robust solution.

Requirements:
- Do NOT list the candidates or mention your internal comparison.
- Deliver the final synthesis as if it were your singular, well-considered plan.
- If presentation is diff, preserve implementation details in patch form.
- Be concise but technically explicit.`;
}

function buildCritiquePrompt(plan: AnalysisPlan, draft: string, monitorSuggestions: string): string {
  const monitorContext = monitorSuggestions === 'STAY_COURSE' 
    ? 'The Cohesion Monitor has approved the current direction.' 
    : `The Cohesion Monitor suggests: ${monitorSuggestions}`;

  return `${DANTE_PERSONA}

Review your draft against the analysis and the Monitor's feedback.

Analysis:
${buildAnalysisContext(plan)}

Monitor Feedback:
${monitorContext}

Draft:
${draft}

Ensure the response is authoritative and free of meta-commentary.
Return:
Critique: one short sentence.
Final: the improved final response only.

  Do not add any other sections.`;
}

function buildFreshnessPrompt(plan: AnalysisPlan, draft: string, critique: string, sources: RetrievedSource[]): string {
  return `${DANTE_PERSONA}

Perform a mandatory freshness check.

Analysis:
${buildAnalysisContext(plan)}

Draft:
${draft}

Critique:
${critique}

Live sources:
${buildRetrievalContext(sources)}

Check whether the response contains any time-sensitive or "latest" claims that would need live verification.
Return:
{
  "requiresFreshVerification": true | false,
  "timeSensitiveClaims": ["..."],
  "safeToUseLatestLanguage": true | false,
  "rewriteGuidance": "short instruction"
}

Do not add any other text.`;
}

function buildFinalPrompt(critique: string, draft: string, sources: RetrievedSource[], freshness: FreshnessCheck): string {
  return `${DANTE_PERSONA}

Finalize your response.

Critique:
${critique}

Draft:
${draft}

Live sources:
${buildRetrievalContext(sources)}

Freshness guidance: ${freshness.rewriteGuidance}

Return the final response only.
- Output strict JSON only:
  {"kind":"text","content":"..."} or {"kind":"diff","content":"..."}
- Deliver it as an authoritative expert.
- Remove all internal wording, "Draft", "Critique", or loop references.
- Stay concise and technical.`;
}

function parseFinalResponse(raw: string): FinalResponse {
  const fallback: FinalResponse = { kind: 'text', content: raw.trim() };
  const json = extractJson(raw);
  if (!json) return fallback;

  try {
    const parsed = JSON.parse(json) as Partial<FinalResponse>;
    const kind: PresentationMode = parsed.kind === 'diff' ? 'diff' : 'text';
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : fallback.content;
    return { kind, content: content || fallback.content };
  } catch {
    return fallback;
  }
}

function pickLatestUserPrompt(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i]!.content;
  }
  return '';
}

export async function resolveSelfPromptResponse(
  provider: LLMProvider,
  messages: LLMMessage[],
  onProgress?: (status: string) => void
): Promise<FinalResponse> {
  const userPrompt = pickLatestUserPrompt(messages);

  onProgress?.('analyzing request...');
  const analysisRaw = await provider.generateResponse([
    ...messages,
    { role: 'user', content: ANALYZE_PROMPT },
  ]);
  const plan = parseAnalysis(analysisRaw);

  onProgress?.('drafting response...');
  const draft = await provider.generateResponse([
    ...messages,
    { role: 'user', content: buildDraftPrompt(plan, userPrompt) },
  ]);

  onProgress?.('monitoring cohesion...');
  const monitorSuggestions = await provider.generateResponse([
    ...messages,
    { role: 'user', content: buildMonitorPrompt(plan, draft) },
  ]);

  onProgress?.('critiquing draft...');
  const critique = await provider.generateResponse([
    ...messages,
    { role: 'user', content: buildCritiquePrompt(plan, draft, monitorSuggestions) },
  ]);

  onProgress?.('searching for sources...');
  const sources = await retrieveSources(provider, plan, userPrompt, draft, monitorSuggestions);

  onProgress?.('checking freshness...');
  const freshnessRaw = await provider.generateResponse([
    ...messages,
    { role: 'user', content: buildFreshnessPrompt(plan, draft, critique, sources) },
  ]);
  const freshness = parseFreshness(freshnessRaw);

  onProgress?.('finalizing answer...');
  const finalPrompt = buildFinalPrompt(critique, draft, sources, freshness);
  const finalRaw = await provider.generateResponse([
    ...messages,
    { role: 'user', content: finalPrompt },
  ]);
  return parseFinalResponse(finalRaw);
}
