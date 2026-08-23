// Normalized SSE event format for portfolio-ai. We own the whole generation
// (unlike the old code, which relayed a vendor's raw SSE stream), so the
// frontend only ever needs to understand these three event types regardless
// of which provider (Groq/Anthropic) or model tier actually served the
// request:
//   event: tool_call   data: { name, args }               — a tool is being invoked
//   event: delta        data: { text }                     — a chunk of the final answer
//   event: done          data: { attribution }             — stream finished successfully
//   event: error          data: { message }                — stream finished with an error
//
// The client-facing error message always comes from classifyChatError's
// fixed vocabulary — never the caught error's own message. Provider errors
// (e.g. "Anthropic request failed: 401 ...") embed upstream response
// bodies/status codes, and forwarding those to the browser both contradicts
// the AI system prompt's "never reveal infrastructure/provider details"
// instruction and hands an attacker a way to fingerprint or probe the
// backend. What DOES reach the client is which *category* of failure this
// was (rate limited vs. temporarily unavailable vs. timed out, etc.) — see
// chat-error-classifier.ts — so the user isn't left with a single flat
// "something went wrong" for every possible cause. The real error (with its
// real status/body) is still fully available server-side via `onError`
// (wired to the caller's structured logger), just never sent over the wire.
import { classifyChatError } from "./chat-error-classifier.ts";

export function createSseStream(
  run: (send: (event: string, data: unknown) => void) => Promise<void>,
  onError?: (err: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } catch (err) {
        onError?.(err);
        send("error", { message: classifyChatError(err).message });
      } finally {
        controller.close();
      }
    },
  });
}

/** Splits text into small whitespace-preserving chunks to simulate incremental delivery. */
export function* chunkText(text: string, wordsPerChunk = 4): Generator<string> {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) {
    yield tokens.slice(i, i + wordsPerChunk).join("");
  }
}
