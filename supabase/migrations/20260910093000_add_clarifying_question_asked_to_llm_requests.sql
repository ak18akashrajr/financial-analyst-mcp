-- Persists whether a chat turn ended by asking the user a clarifying
-- question (see _shared/clarifying-question-tool.ts's ASK_CLARIFYING_QUESTION_TOOL)
-- instead of guessing at an ambiguous request.
--
-- Before this: portfolio-ai/index.ts's "Chat request completed" stdout log
-- line already carried `clarifyingQuestionAsked`, but the recordLlmRequest()
-- insert into llm_requests never included it, so the fact didn't survive
-- past stdout's own retention window — every other per-request fact in that
-- "Chat request completed" line (escalated, openRouterFallback,
-- forcedGroundingRetryUsed, ...) already has a matching llm_requests column;
-- this one didn't, purely by omission.
alter table public.llm_requests
  add column if not exists clarifying_question_asked boolean not null default false;
