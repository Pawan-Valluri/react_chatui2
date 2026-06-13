/**
 * NetworkManager handles the SSE streams and provides mechanics
 * to abort streams instantly if the user switches contexts.
 */
export class NetworkManager {
  private activeStreams: Map<string, AbortController> = new Map();

  /**
   * Starts listening to an SSE stream of LLM tool calls.
   */
  startStream(documentId: string, endpoint: string, onChunk: (data: any) => void) {
    // Abort any existing stream for this document
    this.abortStream(documentId);

    const controller = new AbortController();
    this.activeStreams.set(documentId, controller);

    fetch(endpoint, { signal: controller.signal })
      .then(async response => {
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          // In real implementation, parse SSE 'data: {...}' lines
          try {
            const parsed = JSON.parse(chunk);
            onChunk(parsed);
          } catch (e) {
            // handle partial chunks
          }
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Stream error:', err);
        }
      })
      .finally(() => {
        this.activeStreams.delete(documentId);
      });
  }

  /**
   * Drops the connection and prevents the backend from committing the transaction.
   */
  abortStream(documentId: string) {
    if (this.activeStreams.has(documentId)) {
      this.activeStreams.get(documentId)!.abort();
      this.activeStreams.delete(documentId);
    }
  }
}
