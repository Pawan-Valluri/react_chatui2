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
   * Helper to generate a valid 8-character hex paragraph ID.
   */
  private genParaId(): string {
    return Math.random().toString(16).slice(2, 10).toUpperCase();
  }

  /**
   * Resolves a style by ID or name from the document package styles definitions,
   * traversing and merging the `basedOn` inheritance chain.
   */
  private resolveStyle(styleId: string | undefined): { pPr: any; rPr: any; tblPr: any; tblStylePr: any; actualStyleId: string } | null {
    if (!styleId) return null;
    
    const doc = this.editorRef?.getDocument?.();
    const styles = doc?.package?.styles?.styles || [];
    if (styles.length === 0) return null;
    
    const cleanId = styleId.toLowerCase().replace(/[\s_\-]+/g, '');
    
    // Try exact or clean name match
    let currentStyle = styles.find((s: any) => 
      s.styleId.toLowerCase() === cleanId || 
      (s.name && s.name.toLowerCase().replace(/[\s_\-]+/g, '') === cleanId)
    );
    
    // Fuzzy search fallback
    if (!currentStyle) {
      currentStyle = styles.find((s: any) => {
        const sIdClean = s.styleId.toLowerCase().replace(/[\s_\-]+/g, '');
        const sNameClean = (s.name || '').toLowerCase().replace(/[\s_\-]+/g, '');
        return sIdClean.includes(cleanId) || sNameClean.includes(cleanId);
      });
    }
    
    if (!currentStyle) return null;
    
    let pPr = {};
    let rPr = {};
    let tblPr = {};
    let tblStylePr: any[] = [];
    const actualStyleId = currentStyle.styleId;
    
    const visited = new Set<string>();
    let walkStyle = currentStyle;
    
    while (walkStyle && !visited.has(walkStyle.styleId)) {
      visited.add(walkStyle.styleId);
      
      if (walkStyle.pPr) pPr = { ...walkStyle.pPr, ...pPr };
      if (walkStyle.rPr) rPr = { ...walkStyle.rPr, ...rPr };
      if (walkStyle.tblPr) tblPr = { ...walkStyle.tblPr, ...tblPr };
      if (walkStyle.tblStylePr) tblStylePr = [ ...walkStyle.tblStylePr, ...tblStylePr ];
      
      const parentId = walkStyle.basedOn;
      walkStyle = parentId ? styles.find((s: any) => s.styleId === parentId) : null;
    }
    
    return { pPr, rPr, tblPr, tblStylePr, actualStyleId };
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
          const target = this.findNodePosById(targetId);
          if (target && styleId) {
             const resolved = this.resolveStyle(styleId);
             let newAttrs = { ...target.node.attrs };
             if (resolved) {
                newAttrs.styleId = resolved.actualStyleId;
                
                if (target.node.type.name === 'paragraph') {
                   const cleanAttrs = {
                      paraId: target.node.attrs.paraId,
                      styleId: resolved.actualStyleId,
                      ...resolved.pPr
                   };
                   if (Object.keys(resolved.rPr).length > 0) {
                      (cleanAttrs as any).defaultTextFormatting = resolved.rPr;
                   }
                   newAttrs = cleanAttrs;
                } else if (target.node.type.name === 'table') {
                   newAttrs._originalFormatting = {
                      tblPr: resolved.tblPr,
                      tblStylePr: resolved.tblStylePr
                   };
                   newAttrs.look = {
                      firstRow: true,
                      firstColumn: true,
                      lastRow: false,
                      lastColumn: false,
                      noHBand: false,
                      noVBand: true
                   };
                   if ((resolved.tblPr as any).cellMargins) {
                      newAttrs.cellMargins = (resolved.tblPr as any).cellMargins;
                   }
                }
             } else {
                newAttrs.styleId = this.getStandardStyleId(styleId);
             }
             tr = tr.setNodeMarkup(target.pos, null, newAttrs);
          }
          break;
        }

        case 'insert_paragraph': {
          const { targetId, position, text, styleId } = args;
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
          
          const paraId = this.genParaId();
          let pAttrs: any = { paraId };
          
          if (styleId) {
             const resolved = this.resolveStyle(styleId);
             if (resolved) {
                pAttrs.styleId = resolved.actualStyleId;
                pAttrs = {
                   ...pAttrs,
                   ...resolved.pPr
                };
                if (Object.keys(resolved.rPr).length > 0) {
                   pAttrs.defaultTextFormatting = resolved.rPr;
                }
             } else {
                pAttrs.styleId = this.getStandardStyleId(styleId);
             }
          }
          
          const pNode = schema.nodes.paragraph.create(pAttrs, text ? schema.text(text) : undefined);
          tr = tr.insert(insertPos, pNode);
          break;
        }

        case 'insert_table': {
          const { targetId, position, rows, cols, styleId } = args;

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
          
          const tableRows = [];
          for (let i = 0; i < rows; i++) {
            const cells = [];
            for (let j = 0; j < cols; j++) {
              const textNode = schema.text(`Cell ${i},${j}`);
              const p = schema.nodes.paragraph.create({ paraId: this.genParaId() }, textNode);
              cells.push(cellType.create({}, p));
            }
            tableRows.push(rowType.create({}, cells));
          }

          const colWidth = Math.floor(9000 / cols);
          const columnWidths = Array(cols).fill(colWidth);
          const tableAttrs: any = { 
             columnWidths: columnWidths 
          };
          
          if (styleId) {
             const resolved = this.resolveStyle(styleId);
             if (resolved) {
                tableAttrs.styleId = resolved.actualStyleId;
                tableAttrs._originalFormatting = {
                   tblPr: resolved.tblPr,
                   tblStylePr: resolved.tblStylePr
                };
                tableAttrs.look = { 
                   firstRow: true, 
                   firstColumn: true, 
                   lastRow: false, 
                   lastColumn: false, 
                   noHBand: false, 
                   noVBand: true 
                };
                if ((resolved.tblPr as any).cellMargins) {
                   tableAttrs.cellMargins = (resolved.tblPr as any).cellMargins;
                }
             } else {
                tableAttrs.styleId = this.getStandardStyleId(styleId);
             }
          }
          
          const tableNode = tableType.create(tableAttrs, tableRows);
          tr = tr.insert(insertPos, tableNode);
          
          const emptyP = schema.nodes.paragraph.create({ paraId: this.genParaId() });
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
          
          const nodeKeys = Object.keys(schema.nodes);
          const lName = nodeKeys.find(n => n === 'list_item' || n === 'listItem' || n === 'li') || 'list_item';
          const listItemType = schema.nodes[lName];
          
          const listItems = items.map((text: string) => {
            const p = schema.nodes.paragraph.create({ paraId: this.genParaId() }, schema.text(text));
            return listItemType ? listItemType.create({ paraId: this.genParaId() }, p) : schema.nodes.list_item.create({ paraId: this.genParaId() }, p);
          });
          
          const listType = cleanStyleId === 'NumberedList' ? schema.nodes.ordered_list : schema.nodes.bullet_list;
          const listNode = listType.create({ styleId: cleanStyleId }, listItems);
          tr = tr.insert(insertPos, listNode);
          
          const emptyP = schema.nodes.paragraph.create({ paraId: this.genParaId() });
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
