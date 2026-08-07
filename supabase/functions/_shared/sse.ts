// Normalized SSE event format for portfolio-ai. We own the whole generation
// (unlike the old code, which relayed a vendor's raw SSE stream), so the
// frontend only ever needs to understand these three event types regardless
// of which provider (Groq/Anthropic) or model tier actually served the
// request:
//   event: tool_call   data: { name, args }               — a tool is being invoked
//   event: delta        data: { text }                     — a chunk of the final answer
//   event: done          data: { attribution }             — stream finished successfully
//   event: error          data: { message }                — stream finished with an error
export function createSseStream(
  run: (send: (event: string, data: unknown) => void) => Promise<void>,
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
        send("error", { message: err instanceof Error ? err.message : "Unknown error" });
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
