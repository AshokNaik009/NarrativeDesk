-- NarrativeDesk Postgres Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ingested events (news + price)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('news', 'price')),
  source VARCHAR(50) NOT NULL,
  symbol VARCHAR(20),
  headline TEXT,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Filter decisions
CREATE TABLE IF NOT EXISTS filter_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id),
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Main agent invocations
CREATE TABLE IF NOT EXISTS agent_invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id),
  model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  schema_compliant BOOLEAN,
  raw_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sub-agent (credibility) invocations
CREATE TABLE IF NOT EXISTS subagent_invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_invocation_id UUID REFERENCES agent_invocations(id),
  model VARCHAR(100) NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  reasoning TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Thesis versions
CREATE TABLE IF NOT EXISTS thesis_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  diff TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proposed decisions from agent
CREATE TABLE IF NOT EXISTS proposed_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_invocation_id UUID REFERENCES agent_invocations(id),
  classification VARCHAR(10) NOT NULL CHECK (classification IN ('ignore', 'monitor', 'act')),
  reasoning TEXT NOT NULL,
  thesis_delta TEXT,
  side VARCHAR(4) CHECK (side IN ('buy', 'sell')),
  coin VARCHAR(20),
  size_pct NUMERIC(5,2),
  invalidation TEXT,
  time_horizon VARCHAR(10) CHECK (time_horizon IN ('1h', '4h', '24h', 'open')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending approvals (HITL state)
CREATE TABLE IF NOT EXISTS pending_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id UUID NOT NULL REFERENCES proposed_decisions(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'edited', 'expired')),
  tag VARCHAR(50),
  tag_freetext TEXT,
  edited_size_pct NUMERIC(5,2),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Executed trades
CREATE TABLE IF NOT EXISTS executed_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_id UUID NOT NULL REFERENCES pending_approvals(id),
  side VARCHAR(4) NOT NULL,
  coin VARCHAR(20) NOT NULL,
  size_pct NUMERIC(5,2) NOT NULL,
  entry_price NUMERIC(20,8),
  invalidation TEXT NOT NULL,
  alpaca_order_id VARCHAR(100),
  closed_at TIMESTAMPTZ,
  close_price NUMERIC(20,8),
  close_reason VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolio snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash NUMERIC(20,2),
  total_value NUMERIC(20,2),
  positions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outcome prices for decisions
CREATE TABLE IF NOT EXISTS outcome_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id UUID NOT NULL REFERENCES proposed_decisions(id),
  coin VARCHAR(20) NOT NULL,
  price_at_decision NUMERIC(20,8),
  price_15m NUMERIC(20,8),
  price_1h NUMERIC(20,8),
  price_4h NUMERIC(20,8),
  price_24h NUMERIC(20,8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guardrail evaluations
CREATE TABLE IF NOT EXISTS guardrail_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id UUID NOT NULL REFERENCES proposed_decisions(id),
  allowed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Error logging for monitoring and debugging
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service VARCHAR(100) NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_symbol ON events(symbol);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_filter_decisions_event ON filter_decisions(event_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_expires ON pending_approvals(expires_at);
CREATE INDEX IF NOT EXISTS idx_executed_trades_coin ON executed_trades(coin);
CREATE INDEX IF NOT EXISTS idx_executed_trades_closed ON executed_trades(closed_at);
CREATE INDEX IF NOT EXISTS idx_guardrail_decisions_decision ON guardrail_decisions(decision_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_service ON error_logs(service);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at);

-- Counter-thesis (devil's advocate) for each pending approval
CREATE TABLE IF NOT EXISTS counter_theses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_id UUID NOT NULL REFERENCES pending_approvals(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trade postmortems (auto-generated when trade closes)
CREATE TABLE IF NOT EXISTS trade_postmortems (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL REFERENCES executed_trades(id) ON DELETE CASCADE,
  postmortem TEXT NOT NULL,
  lesson TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chat log between user and agent (optional persistence)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counter_theses_approval ON counter_theses(approval_id);
CREATE INDEX IF NOT EXISTS idx_trade_postmortems_trade ON trade_postmortems(trade_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
