import * as Y from 'yjs';

/**
 * DocumentPool manages the in-memory cache of Y.Doc instances.
 * This prevents redundant network requests and seamlessly handles
 * multi-document environments within a single conversation.
 */
export class DocumentPool {
  private static MAX_DOCS = 5;
  private static docs: Map<string, Y.Doc> = new Map();
  private static order: string[] = [];

  /**
   * Retrieves an existing Y.Doc for a document_id or creates a new one.
   * Enforces LRU eviction if MAX_DOCS is exceeded.
   */
  static getDoc(documentId: string): Y.Doc {
    if (this.docs.has(documentId)) {
      // Move to end of order (most recently used)
      this.order = this.order.filter(id => id !== documentId);
      this.order.push(documentId);
      return this.docs.get(documentId)!;
    }

    if (this.docs.size >= this.MAX_DOCS) {
      const oldestId = this.order.shift();
      if (oldestId) {
        this.docs.delete(oldestId);
        console.log(`Evicted document ${oldestId} from pool.`);
      }
    }

    const doc = new Y.Doc();
    this.docs.set(documentId, doc);
    this.order.push(documentId);
    return doc;
  }

  /**
   * Optional: Clear a specific document from the pool
   */
  static clearDoc(documentId: string) {
    this.docs.delete(documentId);
  }
}
