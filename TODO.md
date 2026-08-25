# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## Portfolio AI / MCP tools

- [ ] Overlap % MCP agent tool to be added
- [ ] All risk ratios to be added
- [x] Async / bounded concurrency — [PR #TBD](https://github.com/ak18akashrajr/financial-analyst-mcp/pulls):
      `portfolio-ai`'s tool-call loop now runs a turn's independent tool calls concurrently
      (bounded by `MAX_CONCURRENT_TOOL_CALLS = 3`) via a new
      [`mapWithConcurrency`](supabase/functions/_shared/concurrency.ts) helper, instead of
      awaiting them one at a time.
- [ ] Retries with backoff
- [ ] Time series forecasting
- [ ] Evaluate OpenRouter + Nemotron plan — see
      [docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md)
