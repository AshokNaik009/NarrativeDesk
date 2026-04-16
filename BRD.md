NarrativeDesk — Real-time Narrative-Driven Paper-Trading Agent with Human-in-the-Loop Approval

PRD for project #4 in the agentic-workflows series. Ready to be pasted as a GitHub issue.


Problem Statement
I've been probing where Claude Agent SDK and agentic workflows actually hold up under real-world pressure. The first three projects in the series each stressed a different axis — silent embedding in a pipeline (GitHub Data Aggregator), long-document semantic extraction (BidMatrix), and reproducible measurement of agent quality (CC-SKILLS-Evals) — but all three share a "start → finish" shape. Input arrives, agent runs, output appears.
I haven't stressed the real-time / streaming axis. When events arrive unpredictably and the agent has to decide while the story is still developing, the entire mental model changes: there are latency budgets, partial context, backpressure, and state that persists across invocations. None of my existing projects surface these failure modes.
I also want to step briefly outside the Claude ecosystem to test whether the architectural patterns I've been learning generalize. Using DeepAgents (TypeScript) with Groq + Gemini tests that portability and keeps my toolset honest.
Finally, I want a project that actually produces the kind of data my CC-SKILLS-Evals harness was designed to consume — labeled agent decisions with real-world outcomes, not synthetic fixtures.
Solution
NarrativeDesk is a real-time, narrative-driven crypto paper-trading agent where I act as the final decision authority. The agent ingests news events and price movements, reasons about them in the context of a thesis file it maintains, and proposes trades with explicit invalidation triggers. Every proposed trade is held in a dashboard until I approve, reject, or edit it. My decisions feed back into the agent as training signal.
The system is deliberately advisory rather than autonomous. The interesting research question is not "can an LLM trade crypto profitably" (it mostly can't) but "can an LLM produce trade proposals that a human thinks are worth considering, and what does that collaboration look like under time pressure?"
The system is built as three Render services (background worker + web dashboard + Postgres), uses free-tier LLMs (Groq Llama 3.3 70B as main agent, Gemini 2.0 Flash as credibility sub-agent), and runs on free data sources (CryptoPanic, Binance WebSocket, Alpaca paper trading). Total marginal cost at steady state: $0.
Scope is split across two weekends with a week of live running in between. Weekend 1 ships end-to-end. The weekday run generates data and surfaces bugs. Weekend 2 adds measurement reporting and polish.
User Stories

As a human trader-operator, I want the agent to ingest crypto news and price events continuously, so that I never have to monitor raw feeds myself.
As a human trader-operator, I want the agent to filter out noise before doing any reasoning, so that I don't burn LLM calls on duplicate headlines or irrelevant news.
As a human trader-operator, I want the agent to classify every event it considers as ignore, monitor, or act, so that I can audit why it did or didn't do something.
As a human trader-operator, I want the agent to maintain a thesis file describing its current market view, so that I can read its evolving reasoning at any time.
As a human trader-operator, I want the agent to call a dedicated credibility sub-agent on each news item, so that thin sources get down-weighted systematically.
As a human trader-operator, I want the agent to propose trades with a mandatory invalidation trigger, so that every trade has a concrete falsification condition.
As a human trader-operator, I want every proposed trade to pause for my approval, so that no paper trade executes without my sign-off.
As a human trader-operator, I want to approve, reject, edit the size of, or tell the agent to wait on any pending trade, so that I have the full range of human oversight actions.
As a human trader-operator, I want to tag every decision with a reason from a dropdown (e.g., strong_thesis, weak_thesis, already_priced_in), so that I'm building labeled data while I work.
As a human trader-operator, I want pending approvals to auto-reject after 15 minutes if I don't respond, so that stale opportunities don't sit indefinitely and I can trust the state I see.
As a human trader-operator, I want the agent to treat my rejections as training signal by updating its thesis with "human disagreed with X", so that rejections improve future proposals rather than disappearing into the void.
As a human trader-operator, I want hard guardrails that the agent cannot override (max 10% per trade, max 3 concurrent positions, max 5 trades per 24h, 15-minute cooldown per coin, hard 5% per-position stop-loss), so that a misbehaving agent cannot produce a dangerous-looking proposal in the first place.
As a human trader-operator, I want a simple web dashboard (Express + HTMX) that shows pending approvals, portfolio state, recent decisions, and current thesis, so that I can manage the system from my phone or laptop.
As a human trader-operator, I want the dashboard to poll every few seconds while a pending approval is on screen, so that I can see countdown timers and status updates in near-real-time.
As a human trader-operator, I want approved trades to execute via Alpaca's paper trading API, so that I get realistic fills, fees, and slippage without writing a simulation engine.
As a human trader-operator, I want every agent invocation, sub-agent call, filter decision, guardrail evaluation, approval action, and price outcome logged to Postgres, so that nothing that happens in the system is invisible after the fact.
As an engineer evaluating the system, I want component metrics logged (model, tokens, latency, schema compliance, tool-call correctness), so that I can tell whether Llama 3.3 70B on Groq is actually healthy as the main agent.
As an engineer evaluating the system, I want decision metrics logged (classification breakdown, thesis deltas, sub-agent correlation), so that I can tell whether the agent is over- or under-trading.
As an engineer evaluating the system, I want trade outcome metrics logged (win rate, profit factor, invalidation accuracy), so that I can measure the joint agent+human system after enough trades accumulate.
As an engineer evaluating the system, I want HITL metrics logged (approval rate, time-to-decision, expiration rate, edit rate, rejection-vs-hindsight correlation), so that I can measure both the agent's proposal quality and my own judgment as the human.
As an engineer evaluating the system, I want the decision log exportable in a format compatible with my CC-SKILLS-Evals harness, so that this project produces real eval fixtures rather than just trading logs.
As an engineer running the system, I want all three services deployable on Render's free tier, so that ongoing cost is zero.
As an engineer running the system, I want the background worker to self-ping the web service every 10 minutes, so that the dashboard doesn't go to sleep and delay approvals.
As an engineer running the system, I want strict Zod schemas for every LLM output, so that malformed tool calls are caught at the boundary rather than corrupting downstream state.
As an engineer running the system, I want the agent to be model-agnostic via LangChain model wrappers, so that I can swap Groq for Gemini (or Claude, or OpenRouter) with an env var.
As an engineer running the system, I want a thesis_versions table that stores every update to the thesis file, so that I can reconstruct what the agent believed at any point.
As an engineer running the system, I want approvals to be idempotent, so that double-clicking approve doesn't execute two trades.
As an engineer running the system, I want integration tests for the ingestion adapters, dashboard routes, and Alpaca client, so that the boundaries between my code and external systems are exercised before deploy.
As an engineer running the system, I want unit tests for the deep modules (EventFilter, DecisionSchemaValidator, GuardrailEngine, InvalidationEvaluator, ApprovalStateMachine), so that the logic that must never fail silently is provably correct.
As a reader of my blog post at the end of the project, I want a clear story about what real-time agentic workflows actually feel like under HITL constraints, so that the project contributes to my series narrative rather than being a standalone demo.

Implementation Decisions
Stack

Language: TypeScript on Node.js (pnpm workspace).
Agent framework: deepagents npm package (from the official LangChain deepagentsjs repo), giving first-class TypeScript support for the four DeepAgents patterns (planning tool, sub-agents, virtual filesystem, detailed system prompt).
Models: Groq Llama 3.3 70B as main agent (fast, free, generous rate limits); Gemini 2.0 Flash as the credibility sub-agent (free tier, good at structured extraction). Both wrapped via LangChain model objects so that the main-agent model is swappable via env var.
Agent backend for virtual FS: StoreBackend with LangGraph's InMemoryStore for in-process memory, plus a custom sync that mirrors the thesis file to Postgres on every update — survives worker restarts without needing persistent disk.

Deployment topology (Render, all free tier)
Three services:

Background Worker — runs ingestion loops (Binance WebSocket, CryptoPanic polling), filter, agent loop, Alpaca integration, thesis sync. Self-pings the web service every 10 minutes.
Web Service — Express server rendering HTMX views for the dashboard. Reads from Postgres, writes human decisions back, polls for pending approvals.
Postgres — shared state across services.

Auth for all LLM providers and external APIs is via environment variables, which survives Render's free-tier restarts. No dependency on persistent disk.
Data sources

CryptoPanic (free API): news headlines with source metadata, polled once per minute.
Binance WebSocket (free public stream): price ticks on the watchlist.
Alpaca paper trading API (free): executes simulated trades, tracks portfolio, applies realistic fees and slippage.
Whale Alert deliberately excluded — free tier is too throttled to be a useful real-time signal source.

Watchlist for v1: BTC, ETH, SOL. Expandable via config.
System flow

Ingestion. Workers normalize incoming events (news or price) into a unified event record and insert into the events table.
Filter. A non-LLM EventFilter module reads the event and recent history, and decides whether to invoke the agent. Dedupes near-identical headlines, enforces watchlist scope, applies rate limits, and respects source reputation. Drops ~90% of events before any LLM is called.
Main agent (Groq). On a filtered event, the deepagentsjs agent is invoked with: the event, the current portfolio state, recent price context, and the current thesis file. The main agent may call the credibility sub-agent.
Credibility sub-agent (Gemini). Invoked by the main agent with isolated context — just the news item. Returns a structured credibility rating 1–5 and brief reasoning. Treated as input signal, not a gate.
Decision output. The main agent writes a classification (ignore | monitor | act), a reasoning, a thesis_delta, and — if acting — an action with side, coin, size_pct, invalidation, and time_horizon. Output is validated against a strict Zod schema.
Guardrails. The GuardrailEngine module evaluates the proposed action against portfolio state and trade history. Rejected proposals never become pending approvals.
Human-in-the-loop. Approved proposals from the agent become pending_approvals rows. deepagentsjs interruptOn pauses the agent graph. The dashboard shows the pending approval. The human takes one of four actions: approve, reject, approve-at-edited-size, or tell-agent-to-wait.
Execution. Approved trades go to Alpaca paper API. Results are recorded in decisions and portfolio_snapshots.
Invalidation watcher. A background loop evaluates every open position's invalidation trigger against the current market state via the InvalidationEvaluator module. Triggered invalidations auto-close the position and log the event.
Logging. Every step — filter decisions, agent prompts and outputs, sub-agent calls, guardrail verdicts, approval actions with tags, Alpaca responses, price outcomes at +15m / +1h / +4h / +24h — writes to Postgres.

Decision schema (enforced by the placePaperTrade tool signature)

classification: ignore | monitor | act
reasoning: 2–3 sentence string
thesis_delta: string describing what changed in the thesis, or "no change"
action (only if classification === "act"):

side: buy | sell
coin: string
size_pct: number, hard max 10
invalidation: string stating the falsification condition
time_horizon: 1h | 4h | 24h | open



Guardrails (enforced outside the agent)

Max 10% of portfolio per single trade.
Max 3 concurrent open positions.
Max 5 trades per 24 hours.
Minimum 15-minute cooldown on the same coin.
Hard 5% per-position stop-loss, auto-closed by the invalidation watcher.
Agent cannot override any of these. Rejected proposals receive a structured reason and are fed back to the agent.

Thesis file structure
Agent-maintained markdown document covering current market regime, active theses per coin (with confidence and invalidation), recent significant events, and watch-conditions. Every edit writes a new row to thesis_versions so the evolution is auditable.
HITL approval lifecycle

pending → approved | rejected | edited | expired.
Expiration: 15 minutes from creation, enforced by the ApprovalStateMachine.
Every terminal transition requires a tag from the appropriate dropdown.
Approve-edit flow lets the human change size_pct downward but not above the agent's original proposal.
All state transitions are idempotent against the approval ID, so dashboard double-clicks never produce duplicate trades.

Self-tag dropdowns

On approve: strong_thesis, reasonable_take, curious_experiment, trusting_the_agent.
On reject: weak_thesis, already_priced_in, wrong_coin, wrong_timing, size_too_large, news_not_credible, portfolio_constraint, other (with required free-text).
On edit-size: same options as approve, plus the new size.

Schema overview (Postgres)
Tables:

events — ingested events (news + price), with source and raw payload.
filter_decisions — one row per event, whether it passed and why.
agent_invocations — one row per main-agent call, with prompt tokens, completion tokens, latency, schema compliance.
subagent_invocations — one row per credibility-agent call, with rating and reasoning.
thesis_versions — every write of the thesis file, with diff and timestamp.
proposed_decisions — classifications with reasoning, whether they became actionable.
pending_approvals — HITL state, with countdown and approval tag.
executed_trades — Alpaca-confirmed trades with entry price and invalidation.
portfolio_snapshots — periodic P&L, cash, positions.
outcome_prices — +15m / +1h / +4h / +24h price marks against each decision.

Module inventory (deep modules)
All of the following are pure or near-pure TypeScript modules with narrow interfaces, designed to be testable without network or LLM access:

EventFilter — (event, recentEvents, config) → FilterDecision. Dedupe, watchlist match, rate-limit, source reputation. No I/O.
DecisionSchemaValidator — (rawLlmOutput) → ParsedDecision | ValidationError. Zod-based, handles common LLM flakiness patterns (code fences, extra keys, missing optional fields).
GuardrailEngine — (proposedAction, portfolio, tradeHistory, config) → { allowed, reason }. Pure.
InvalidationEvaluator — (invalidationTrigger, marketState) → { triggered, reason }. Pure against injected market state.
ApprovalStateMachine — (currentState, action, now) → nextState | Error. Deterministic lifecycle transitions, idempotency, timeout handling.
ThesisManager — read/write/diff of the thesis markdown, with Postgres sync as a side-effect. Integration-tested only.
MetricsCalculator — takes raw decision log rows, computes Layer 1–4 metrics. Integration-tested only.

LLM and agent configuration

Main agent: ChatGroq with llama-3.3-70b-versatile, temperature 0.2.
Credibility sub-agent: ChatGoogleGenerativeAI with gemini-2.0-flash, temperature 0.0.
Main-agent system prompt codifies: default action is hold; act only on novel high-conviction information; always state invalidation; update thesis before proposing.
Sub-agent system prompt is narrow: rate this news item 1–5 for likely market impact, with reasoning, in a structured format.
interruptOn: { placePaperTrade: { allowedDecisions: ['approve', 'edit', 'reject'] } } — wired through HITL middleware to the Postgres approval queue.
Rate limits are honored by a token-bucket wrapper around each model client; exceeding them queues the call instead of failing hard.

Measurement and logging
All four measurement layers are logged from day one, even if the dashboard displays only a subset:

Layer 1 (component): model, prompt/completion tokens, latency, schema compliance, tool-call correctness.
Layer 2 (decision): classification breakdown, thesis deltas, sub-agent correlation.
Layer 3 (trade): win rate, average win, average loss, profit factor, invalidation accuracy.
Layer 4 (HITL): approval rate, time-to-decision, expiration rate, edit rate, correlation between rejection reason and later price action.

The dashboard in v1 displays a subset (pending approvals, current portfolio P&L, recent 20 decisions with outcomes, current thesis). The full metrics run as a weekly offline job producing a markdown report checked into the repo.
A decision-log exporter produces eval fixtures in the schema expected by the CC-SKILLS-Evals harness (project #3), enabling offline replay and model-swap comparisons.
Timeline

Weekend 1: scaffolding, Postgres schema, ingestion, filter, main agent + credibility sub-agent, placePaperTrade with interruptOn, minimal Express + HTMX dashboard with approval loop + self-tag dropdown, Alpaca integration, end-to-end deploy to Render. Stretch: portfolio view, recent-decisions view.
Weekdays: the system runs; I use the dashboard; bugs and observations get logged.
Weekend 2: weekly metrics report (Layers 1–4), eval-fixture exporter, dashboard polish (portfolio + thesis + decision history views), bug fixes, writeup.

Testing Decisions
What makes a good test here
Tests exercise external behavior of a module — inputs and outputs of its public interface — not its internals. A good test can survive any internal rewrite as long as the module's contract holds. In this codebase that specifically means:

Tests should mock at module boundaries (Postgres, Alpaca, LLM clients), not inside the module under test.
Pure modules (EventFilter, DecisionSchemaValidator, GuardrailEngine, InvalidationEvaluator, ApprovalStateMachine) get unit tests with zero mocking — they have no external dependencies to mock.
Modules with I/O (ThesisManager, MetricsCalculator, ingestion adapters, Alpaca client, dashboard routes) get integration tests that exercise the real boundary with a test Postgres instance and recorded-fixture responses.
LLM agents themselves are not unit-tested. They are evaluated via the eval fixtures produced by the running system — which is the whole point of integrating with the CC-SKILLS-Evals harness.

Test framework
Jest with ts-jest, one describe block per module, it blocks named as behaviors (e.g., it("rejects duplicate headlines within the dedupe window")), no snapshot tests. Coverage target: 90%+ on the five unit-tested modules; no coverage target on modules that are integration-tested only.
Modules with unit tests (v1)

EventFilter — cases cover: dedupe within window, watchlist match, rate-limit enforcement per source, source reputation below threshold, edge cases around simultaneous events, clock monotonicity assumptions. Roughly 15–20 tests.
DecisionSchemaValidator — cases cover: well-formed output, output wrapped in code fences, output with extra keys, missing required fields, action present when classification !== "act", size_pct out of range, non-enum side/time_horizon. Roughly 12–15 tests.
GuardrailEngine — cases cover: size above 10%, fourth concurrent position, sixth trade in 24h, cooldown violation, approaching drawdown limit, exact-boundary cases for each limit, composite violations reporting the most specific reason. Roughly 15 tests.
InvalidationEvaluator — cases cover: price-based invalidation triggered / not triggered, time-based invalidation expired / pending, compound invalidation ("X OR Y"), malformed invalidation strings, market-state unavailable. Roughly 10 tests.
ApprovalStateMachine — cases cover: valid transitions (pending→approved/rejected/edited/expired), invalid transitions rejected, idempotency on repeated terminal actions, timeout transition at exactly 15 minutes, tag required on terminal transition. Roughly 12 tests.

Modules explicitly covered by integration tests only (v1)

ThesisManager — tested via the actual sync flow in an integration harness against a test Postgres instance.
MetricsCalculator — tested via the weekly-report job against a seeded decision log.
Ingestion adapters (CryptoPanic, Binance) — tested with recorded fixture responses.
Alpaca paper trading client — tested against Alpaca's paper sandbox with a throwaway account.
Dashboard routes — tested with supertest against the Express app, hitting a test Postgres.

Prior art
Test patterns to mirror:

Pure-function modules: my CC-SKILLS-Evals repo has existing Jest test patterns for scoring functions (pure in/pure out) that this project should follow directly.
Schema validators: the Zod validation patterns used in BidMatrix's bid-extraction layer.
Integration-with-Postgres: established via CC-SKILLS-Evals's fixture-replay tests.
If any of the above patterns don't exist yet in a shared form, extract them into a small testing-utils package in this repo during weekend 1.

Out of Scope

Real money trading. This is paper trading only. Never wired to a real exchange. Not now, not in v2.
Autonomous trading (no HITL). The advisory framing is the project. An autonomous mode is not planned.
Multi-user dashboard. Single-user, single-account. No auth beyond a shared secret via env var.
Push notifications, Telegram, email alerts. Weekend 1 relies on me checking the dashboard. A notification layer may come in a future iteration but is explicitly not part of this project.
Native mobile app. The dashboard is a responsive web UI, usable on mobile, but there is no iOS/Android build.
Equities or non-crypto assets. Crypto only, because of free data availability and 24/7 markets.
On-chain data sources. Whale Alert's free tier is too throttled to be useful; on-chain signals are deferred.
Long-term storage beyond 90 days. Render free Postgres has a 90-day expiry. Long-term data retention is deferred; when the DB expires I either upgrade or migrate.
Training or fine-tuning any model. The project produces labeled data that could be used for fine-tuning, but fine-tuning is not in scope.
Unit-testing the agent's reasoning. LLM reasoning quality is measured via evals in the CC-SKILLS-Evals harness, not via Jest unit tests.
Self-improving agent that rewrites its own prompt. System prompts are configuration, not data.
Any trading beyond spot-style long/short exposure. No options, futures, leverage, or derivatives.
Latency-critical HFT paths. The system is explicitly for narrative-timescale decisions (minutes to hours), not tick-level reactions.

Further Notes

Why TypeScript and not Python. The original DeepAgents library is Python, but deepagentsjs is a first-class TypeScript port maintained by LangChain (not a community fork) with batteries-included support for the same four patterns. Going TypeScript preserves my productivity, fits Render deploy cleanly, and keeps the dashboard and agent in one language.
Why a deliberate step outside the Claude ecosystem. Projects #1–3 all used Claude and the Claude Agent SDK. #4 tests whether the patterns I've been learning generalize by using Groq + Gemini via deepagentsjs. The series narrative becomes: "I'm not a Claude developer, I'm an agentic-workflows developer who happens to have used Claude a lot." The architecture is model-agnostic via env var, so switching back to Claude is trivial.
Why HITL over autonomous. Autonomous paper trading is a toy. HITL is the real product pattern. It also produces richer data — every approval, rejection, and edit is a labeled example of agent-vs-human judgment.
Why a thesis file rather than a vector store. The thesis is small, structured, human-readable, and auditable. A vector store would be overkill and less introspectable. If the thesis grows beyond a few KB, thesis_versions lets us slice it historically.
Why the filter layer is non-LLM. Cost control and latency. Without it, every duplicate headline becomes a Groq + Gemini round-trip. With it, 90%+ of events are dropped for ~0ms and ~0 tokens.
The invalidation field is doing real work. It's not cosmetic. It's what makes the agent's reasoning falsifiable, it drives the automated exit logic, and it becomes part of the eval — the honest test of whether the agent's stated conditions actually fired when trades went wrong.
Week-2 data is the point, not weekend-1 trades. After a weekend I'll have ~30–80 agent invocations and ~3–10 executed trades — not enough for trade-outcome conclusions. That's fine. The project is the measurement infrastructure; conclusions emerge at week 3+.
Open threads to revisit. (a) If Groq rate limits bite, fall back to OpenRouter free models with retry. (b) If Render free Web Service sleep causes pain despite self-ping, switch the dashboard to a single combined Web Service (merging worker + dashboard) and accept the tradeoff. (c) If the dashboard becomes valuable enough in its own right, weekend-3 work could rewrite it in Next.js.
Series arc after this project. #1 was silent embedding. #2 was long-doc extraction on subscription. #3 was measurement infrastructure. #4 is real-time narrative reasoning under HITL. A natural #5 would be multi-agent coordination — now that I've actually built a system that has sub-agents, I've earned the right to ask what happens when they disagree.