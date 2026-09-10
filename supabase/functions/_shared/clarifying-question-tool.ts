import type { McpToolDef } from "./mcp-client.ts";

/**
 * A synthetic "tool" — not backed by any SQL query, and never sent to the
 * real MCP server (compare _shared/mcp-tools.ts, whose entries are all real,
 * SQL-backed portfolio-data tools per CLAUDE.md's "real MCP server, not
 * prose tools" architecture). This one exists purely so the model has a
 * structured, tool_choice-compatible way to ask the user a clarifying
 * question instead of guessing at a missing or genuinely ambiguous
 * parameter — see SYSTEM_PROMPT's "Ambiguous requests" section for when to
 * use it.
 *
 * Why a tool and not just a plain-text answer: portfolio-ai/index.ts's
 * forced-grounding-retry guard (see tool-grounding-gate.test.ts) treats ANY
 * zero-tool-call answer as suspect — the exact shape of the 2026-09-08
 * hallucination bug — and forces one retry under `tool_choice: "required"`,
 * which is API-enforced and makes a plain-text response impossible on that
 * retry. A model that just tries to ask its question as ordinary text
 * therefore never actually gets it to the user. Calling this tool instead
 * IS a real tool call, so it passes the grounding guard cleanly without
 * weakening it for actual hallucinated claims — see the short-circuit for
 * `ASK_CLARIFYING_QUESTION_TOOL.name` in index.ts's turn loop, which reads
 * `question` back out and streams it as the final answer directly, instead
 * of forwarding this call to mcpClient.callTool like a real MCP tool.
 */
export const ASK_CLARIFYING_QUESTION_TOOL: McpToolDef = {
  name: "ask_clarifying_question",
  description:
    "Ask the user a single, specific question instead of guessing, when their request is genuinely " +
    "ambiguous in a way that would change which data gets returned (not for typos or informal " +
    "phrasing — interpret those instead of asking). Call this alone, with nothing else, as your " +
    "entire response for this turn: it ends the turn immediately with your question, and no " +
    "portfolio tool is called.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        minLength: 1,
        description: "The single clarifying question to ask the user, in plain language.",
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
};
