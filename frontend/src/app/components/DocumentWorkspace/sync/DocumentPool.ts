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
   * Retrieves an existing Y.Doc for a messageId or creates a new one.
   * Enforces LRU eviction if MAX_DOCS is exceeded.
   */
  static getDoc(messageId: string): Y.Doc {
    if (this.docs.has(messageId)) {
      // Move to end of order (most recently used)
      this.order = this.order.filter(id => id !== messageId);
      this.order.push(messageId);
      return this.docs.get(messageId)!;
    }

    if (this.docs.size >= this.MAX_DOCS) {
      const oldestId = this.order.shift();
      if (oldestId) {
        this.docs.delete(oldestId);
      }
    }

    const doc = new Y.Doc();
    this.docs.set(messageId, doc);
    this.order.push(messageId);
    return doc;
  }

  /**
   * Aliases an existing document to a new messageId for linear continuations.
   */
  static aliasDoc(oldId: string, newId: string) {
    if (this.docs.has(oldId)) {
      const doc = this.docs.get(oldId)!;
      this.docs.set(newId, doc);
      this.order = this.order.filter(id => id !== oldId && id !== newId);
      this.order.push(newId);
    }
  }

  /**
   * Optional: Clear a specific document from the pool
   */
  static clearDoc(messageId: string) {
    this.docs.delete(messageId);
  }
}
