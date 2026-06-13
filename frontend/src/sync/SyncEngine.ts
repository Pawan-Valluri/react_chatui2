import * as Y from 'yjs';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';

/**
 * SyncEngine bridges the ProseMirror editor state with the Yjs CRDT model.
 */
export class SyncEngine {
  /**
   * Generates ProseMirror plugins required to bind the editor to a Yjs document.
   */
  static getPlugins(yDoc: Y.Doc, xmlFragmentName: string = 'prosemirror') {
    const type = yDoc.getXmlFragment(xmlFragmentName);
    return [
      ySyncPlugin(type),
      yUndoPlugin()
    ];
  }

  /**
   * Computes the exact binary difference caused by an LLM edit.
   */
  static extractDelta(preStateVector: Uint8Array, postDoc: Y.Doc): Uint8Array {
    return Y.encodeStateAsUpdate(postDoc, preStateVector);
  }

  /**
   * POSTs the resulting binary delta to the server to lock the transaction.
   */
  static async pushCommit(documentId: string, messageId: string, delta: Uint8Array): Promise<void> {
    const response = await fetch(`/api/documents/${documentId}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Message-ID': messageId
      },
      body: delta as any
    });

    if (!response.ok) {
      throw new Error('Failed to commit delta to server');
    }
  }
}
