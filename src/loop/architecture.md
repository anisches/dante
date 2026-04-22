# Self-Prompting Loop Architecture

## Overview
A recursive self-critique and refinement system that analyzes, evaluates, and iterates on responses.

## Loop Flow

```
┌─────────────────┐
│  User Prompt    │
└────────┬────────┘
         ▼
┌─────────────────┐
│  ANALYZE PHASE  │
│  - What is it?  │
│  - What is not? │
│  - Action vs Answer? │
└────────┬────────┘
         ▼
┌─────────────────┐
│  DECISION BRANCH │
└────────┬────────┘
         ├──► ANSWER MODE ──► Precise Answer + Persuasive Query/Fun Fact
         │
           └──► ACTION MODE ──► Query Generation ──► Simulation ──► Comparison ──► Weighted Compression

Before freshness checking, the loop now performs live web retrieval and source lookup.
Mandatory freshness check runs before the final output in both branches.
Time-sensitive claims are rewritten conservatively unless live verification exists.
```

## Phase 1: Analysis Prompt
```
Analyze this prompt:
1. What IS it asking for?
2. What is NOT being asked (implicit constraints, assumptions)?
3. Does this require ACTION or just an ANSWER?
4. What are the key entities, goals, and success criteria?
```

## Phase 2: Answer Mode
```
Provide a precise, direct answer. Then include:
- A persuasive query (challenges/validates the answer)
- OR a relevant fun fact, but only if freshness is verified from live sources
```

## Phase 3: Action Mode (Iterative)
```
1. Generate candidate approaches
2. Simulate each approach
3. Compare and sort by:
   - Effectiveness
   - Efficiency
   - Risk/Complexity
   - Maintainability
4. Compress the candidate space into one synthesis
5. Give more weight to the strongest candidate, but do not discard useful minority signals
6. LOOP: Re-evaluate with new perspective
```

## Iteration Structure
- Each loop iteration refines the previous
- Converges when no meaningful improvement
- Maximum iterations: N (configurable)
