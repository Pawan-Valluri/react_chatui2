import * as Y from 'yjs';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { docxStylingAndNumberingPlugin } from './NumberingPlugin';

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
      yUndoPlugin(),
      docxStylingAndNumberingPlugin
    ];
  }

}
