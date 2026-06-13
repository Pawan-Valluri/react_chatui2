import { EditorView } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';

/**
 * EditorBridge interprets SSE streams containing LLM tool calls
 * and dispatches them directly onto the ProseMirror state.
 */
export class EditorBridge {
  private view: EditorView;
  private editorRef: any;

  constructor(view: EditorView, editorRef?: any) {
    this.view = view;
    this.editorRef = editorRef;
    (window as any)._pmView = view;
  }

  /**
   * Helper to map a style name (e.g. "Table Grid", "heading 1", "title") to the standard DOCX style ID.
   */
  /**
   * Helper to map a style name (e.g. "Table Grid", "heading 1", "title") to the standard DOCX style ID.
   * Uses an algorithmic approach: removes spaces/punctuation and Capitalizes Each Word.
   */
  private getStandardStyleId(requestedStyleName: string | undefined): string | undefined {
    if (!requestedStyleName) return undefined;
    
    return requestedStyleName
      .split(/[\s_\-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  /**
   * Helper to find a node by its ID attribute.
   */
  private findNodePosById(targetId: string): { pos: number; node: PMNode } | null {
    let result = null;
    this.view.state.doc.descendants((node, pos) => {
      if (node.attrs && node.attrs.id === targetId) {
        result = { pos, node };
        return false; // Stop searching this branch
      }
      return true;
    });
    return result;
  }

  /**
   * Executes a parsed LLM tool call locally.
   */
  executeToolCall(toolName: string, args: any) {
    const { state, dispatch } = this.view;
    const { schema } = state;
    let tr = state.tr;

    try {
      switch (toolName) {
        case 'apply_style': {
          const { targetId, styleId } = args;
          const cleanStyleId = this.getStandardStyleId(styleId);
          const target = this.findNodePosById(targetId);
          if (target && cleanStyleId) {
             let newAttrs = { ...target.node.attrs, styleId: cleanStyleId };
             // Dynamically extract style formatting
             const stylesKey = Object.keys(this.view.state).find(k => k.startsWith('documentStyles$'));
             if (stylesKey) {
                const stylesState = (this.view.state as any)[stylesKey];
                const stylesById = stylesState?.stylesById || {};
                
                let matchedStyleId = cleanStyleId;
                if (!stylesById[matchedStyleId]) {
                   const possibleKeys = Object.keys(stylesById).filter(k => k.toLowerCase() === matchedStyleId.toLowerCase());
                   if (possibleKeys.length > 0) matchedStyleId = possibleKeys[0];
                }
                
                const pStyle = stylesById[matchedStyleId];
                if (pStyle) {
                   if (pStyle.paragraphFormatting) newAttrs.paragraphFormatting = pStyle.paragraphFormatting;
                   if (pStyle.runFormatting) newAttrs.runFormatting = pStyle.runFormatting;
                }
             }
             tr = tr.setNodeMarkup(target.pos, null, newAttrs);
          }
          break;
        }

        case 'insert_paragraph': {
          const { targetId, position, text, styleId } = args;
          const cleanStyleId = this.getStandardStyleId(styleId);
          let insertPos = state.doc.content.size;
          state.doc.descendants((node, p) => {
            if (node.type.name === 'body' || node.type.name === 'section') {
              insertPos = p + 1 + node.content.size;
            }
            return true;
          });
          if (targetId && targetId !== 'editor_root') {
            const target = this.findNodePosById(targetId);
            if (target) {
              insertPos = position === 'before' ? target.pos : target.pos + target.node.nodeSize;
            }
          }
          
          const paraId = genParaId();
          let pAttrs: any = { paraId };
          if (cleanStyleId) {
             pAttrs.styleId = cleanStyleId;
             const stylesKey = Object.keys(this.view.state).find(k => k.startsWith('documentStyles$'));
             if (stylesKey) {
                const stylesState = (this.view.state as any)[stylesKey];
                const stylesById = stylesState?.stylesById || {};
                
                let matchedStyleId = cleanStyleId;
                if (!stylesById[matchedStyleId]) {
                   const possibleKeys = Object.keys(stylesById).filter(k => k.toLowerCase() === matchedStyleId.toLowerCase());
                   if (possibleKeys.length > 0) matchedStyleId = possibleKeys[0];
                }
                
                const pStyle = stylesById[matchedStyleId];
                if (pStyle) {
                   if (pStyle.paragraphFormatting) pAttrs.paragraphFormatting = pStyle.paragraphFormatting;
                   if (pStyle.runFormatting) pAttrs.runFormatting = pStyle.runFormatting;
                }
             }
          }
          
          const pNode = schema.nodes.paragraph.create(pAttrs, text ? schema.text(text) : undefined);
          tr = tr.insert(insertPos, pNode);
          break;
        }

        case 'insert_table': {
          const { targetId, position, rows, cols, styleId } = args;
          const cleanStyleId = this.getStandardStyleId(styleId);

          let insertPos = state.doc.content.size;
          state.doc.descendants((node, p) => {
            if (node.type.name === 'body' || node.type.name === 'section') {
              insertPos = p + 1 + node.content.size;
            }
            return true;
          });

          if (targetId && targetId !== 'editor_root') {
            const target = this.findNodePosById(targetId);
            if (target) {
              insertPos = position === 'before' ? target.pos : target.pos + target.node.nodeSize;
            }
          }

          const nodeKeys = Object.keys(schema.nodes);
          const tName = nodeKeys.find(n => n === 'table' || n === 'tbl' || n === 'tableNode') || 'table';
          const rName = nodeKeys.find(n => n === 'table_row' || n === 'tableRow' || n === 'tr') || 'table_row';
          const cName = nodeKeys.find(n => n === 'table_cell' || n === 'tableCell' || n === 'tc') || 'table_cell';
          
          const tableType = schema.nodes[tName];
          const rowType = schema.nodes[rName];
          const cellType = schema.nodes[cName];
          
          if (!tableType || !rowType || !cellType) {
            console.error("Missing table nodes:", {tName, rName, cName}, "Available:", nodeKeys);
            break;
          }
          
          const genParaId = () => Math.random().toString(16).slice(2, 10).toUpperCase();

          const tableRows = [];
          for (let i = 0; i < rows; i++) {
            const cells = [];
            for (let j = 0; j < cols; j++) {
              const textNode = schema.text(`Cell ${i},${j}`);
              const p = schema.nodes.paragraph.create({ paraId: genParaId() }, textNode);
              cells.push(cellType.create({}, p));
            }
            tableRows.push(rowType.create({}, cells));
          }

          const colWidth = Math.floor(9000 / cols);
          const columnWidths = Array(cols).fill(colWidth);
          const tableAttrs: any = { 
             columnWidths: columnWidths 
          };
          if (cleanStyleId) {
             tableAttrs.styleId = cleanStyleId;
             
             // Dynamically extract style formatting from the documentStyles$ plugin
             const stylesKey = Object.keys(this.view.state).find(k => k.startsWith('documentStyles$'));
             if (stylesKey) {
                const stylesState = (this.view.state as any)[stylesKey];
                const stylesById = stylesState?.stylesById || {};
                
                // Fuzzy match the style ID since DOCX often appends 'Table' to the ID
                let matchedStyleId = cleanStyleId;
                if (!stylesById[matchedStyleId]) {
                   const possibleKeys = Object.keys(stylesById).filter(k => 
                      k.toLowerCase() === matchedStyleId.toLowerCase() || 
                      k.toLowerCase() === matchedStyleId.toLowerCase() + 'table' ||
                      k.toLowerCase().replace('table', '') === matchedStyleId.toLowerCase().replace('table', '')
                   );
                   if (possibleKeys.length > 0) {
                      matchedStyleId = possibleKeys[0];
                   }
                }
                
                const tableStyle = stylesById[matchedStyleId];
                if (tableStyle && tableStyle.tableFormatting) {
                   const tf = tableStyle.tableFormatting;
                   if (tf.borders) tableAttrs.tblBorders = tf.borders;
                   if (tf.shading) tableAttrs.shd = tf.shading;
                   // Cell defaults
                   if (tf.cellMargin) tableAttrs.tblCellSpacing = tf.cellMargin;
                }
             }
          }
          
          const tableNode = tableType.create(tableAttrs, tableRows);
          tr = tr.insert(insertPos, tableNode);
          
          const emptyP = schema.nodes.paragraph.create({ paraId: genParaId() });
          tr = tr.insert(insertPos + tableNode.nodeSize, emptyP);
          break;
        }

        case 'insert_list': {
          const { targetId, position, items, listStyleId } = args;
          const cleanStyleId = this.getStandardStyleId(listStyleId);
          let insertPos = state.doc.content.size;
          state.doc.descendants((node, p) => {
            if (node.type.name === 'body' || node.type.name === 'section') {
              insertPos = p + 1 + node.content.size;
            }
            return true;
          });

          if (targetId && targetId !== 'editor_root') {
            const target = this.findNodePosById(targetId);
            if (target) {
              insertPos = position === 'before' ? target.pos : target.pos + target.node.nodeSize;
            }
          }
          const newId = crypto.randomUUID();
          
          const nodeKeys = Object.keys(schema.nodes);
          const lName = nodeKeys.find(n => n === 'list_item' || n === 'listItem' || n === 'li') || 'list_item';
          const listItemType = schema.nodes[lName];
          
          const listItems = items.map((text: string) => {
            const p = schema.nodes.paragraph.create({ id: crypto.randomUUID() }, schema.text(text));
            return listItemType ? listItemType.create({ id: crypto.randomUUID() }, p) : schema.nodes.list_item.create({ id: crypto.randomUUID() }, p);
          });
          
          const listType = cleanStyleId === 'NumberedList' ? schema.nodes.ordered_list : schema.nodes.bullet_list;
          const listNode = listType.create({ id: newId, styleId: cleanStyleId }, listItems);
          tr = tr.insert(insertPos, listNode);
          
          const emptyP = schema.nodes.paragraph.create({ id: crypto.randomUUID() });
          tr = tr.insert(insertPos + listNode.nodeSize, emptyP);
          break;
        }

        default:
          console.warn(`Unknown tool call: ${toolName}`);
      }

      if (tr.docChanged) {
        dispatch(tr);
      }
    } catch (err) {
      console.error(`Error executing ${toolName}:`, err);
    }
  }
}
