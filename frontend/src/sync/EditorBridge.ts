import { EditorView } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
import { resolveColor } from '@eigenpal/docx-editor-core';

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
   * Helper to resolve theme colors to a 6-digit hex string without leading '#'
   */
  private resolveThemeColor(colorVal: any, theme: any): any {
    if (!colorVal) return colorVal;
    if (typeof colorVal === 'string') {
      if (colorVal === 'auto' || colorVal === 'clear') return undefined;
      return { rgb: colorVal.startsWith('#') ? colorVal.slice(1) : colorVal };
    }
    if (colorVal.themeColor && theme) {
      try {
        const resolved = resolveColor(colorVal, theme);
        if (resolved) {
          return { ...colorVal, rgb: resolved.startsWith('#') ? resolved.slice(1) : resolved };
        }
      } catch (err) {
        console.warn("Failed to resolve theme color:", colorVal, err);
      }
    }
    return colorVal;
  }

  /**
   * Helper to resolve theme colors in borders
   */
  private resolveBorderColors(borders: any, theme: any): any {
    if (!borders) return borders;
    const resolved: any = {};
    for (const side of ['top', 'bottom', 'left', 'right', 'between', 'bar', 'insideH', 'insideV']) {
      if (borders[side]) {
        resolved[side] = {
          ...borders[side],
          color: this.resolveThemeColor(borders[side].color, theme)
        };
      }
    }
    return resolved;
  }

  /**
   * Helper to create ProseMirror marks from resolved run properties (rPr)
   */
  private createMarksFromRPr(rPr: any, schema: any, theme: any): any[] {
    const marks: any[] = [];
    if (!rPr) return marks;

    if (rPr.bold && schema.marks.bold) {
      marks.push(schema.marks.bold.create());
    }
    if (rPr.italic && schema.marks.italic) {
      marks.push(schema.marks.italic.create());
    }
    if (rPr.underline && schema.marks.underline) {
      const style = typeof rPr.underline === 'object' ? rPr.underline.style : 'single';
      let color = typeof rPr.underline === 'object' ? rPr.underline.color : undefined;
      if (color) {
        color = this.resolveThemeColor(color, theme);
      }
      marks.push(schema.marks.underline.create({ style, color }));
    }
    if (rPr.strike && schema.marks.strike) {
      marks.push(schema.marks.strike.create());
    }
    if (rPr.doubleStrike && schema.marks.strike) {
      marks.push(schema.marks.strike.create({ double: true }));
    }
    if (rPr.color && schema.marks.textColor) {
      const colorVal = this.resolveThemeColor(rPr.color, theme);
      marks.push(schema.marks.textColor.create({
        rgb: colorVal?.rgb ?? null,
        themeColor: rPr.color.themeColor ?? null,
        themeTint: rPr.color.themeTint ?? null,
        themeShade: rPr.color.themeShade ?? null,
      }));
    }
    if (rPr.highlight && schema.marks.highlight) {
      marks.push(schema.marks.highlight.create({ color: rPr.highlight }));
    }
    if (rPr.fontSize && schema.marks.fontSize) {
      marks.push(schema.marks.fontSize.create({ size: rPr.fontSize }));
    }
    if (rPr.fontFamily && schema.marks.fontFamily) {
      marks.push(schema.marks.fontFamily.create({
        ascii: rPr.fontFamily.ascii ?? null,
        hAnsi: rPr.fontFamily.hAnsi ?? rPr.fontFamily.ascii ?? null,
        asciiTheme: rPr.fontFamily.asciiTheme ?? null,
      }));
    }
    return marks;
  }

  /**
   * Helper to merge table conditional formatting parts by type
   */
  private mergeTblStylePr(parentParts: any[], childParts: any[]): any[] {
    const merged: any[] = [];
    const parentMap = new Map(parentParts?.map(p => [p.type, p]) || []);
    const childMap = new Map(childParts?.map(p => [p.type, p]) || []);
    
    const allTypes = new Set([...parentMap.keys(), ...childMap.keys()]);
    for (const type of allTypes) {
      const parentPart = parentMap.get(type);
      const childPart = childMap.get(type);
      
      if (parentPart && childPart) {
        merged.push({
          type,
          pPr: { ...parentPart.pPr, ...childPart.pPr },
          rPr: { ...parentPart.rPr, ...childPart.rPr },
          tblPr: { ...parentPart.tblPr, ...childPart.tblPr },
          trPr: { ...parentPart.trPr, ...childPart.trPr },
          tcPr: { ...parentPart.tcPr, ...childPart.tcPr },
        });
      } else if (childPart) {
        merged.push(childPart);
      } else if (parentPart) {
        merged.push(parentPart);
      }
    }
    return merged;
  }

  /**
   * Helper to resolve cell borders, shading, and rPr based on position and look flags
   */
  private resolveCellFormatting(
    r: number,
    c: number,
    totalRows: number,
    totalCols: number,
    resolvedStyle: any,
    theme: any
  ) {
    if (!resolvedStyle) return { borders: undefined, backgroundColor: undefined, rPr: undefined };

    const { tblPr, tblStylePr } = resolvedStyle;
    
    let cellShd = tblPr?.shading?.fill;
    
    let cellBorders: any = {};
    if (tblPr?.borders) {
      const b = tblPr.borders;
      cellBorders.top = r === 0 ? b.top : b.insideH;
      cellBorders.bottom = r === totalRows - 1 ? b.bottom : b.insideH;
      cellBorders.left = c === 0 ? b.left : b.insideV;
      cellBorders.right = c === totalCols - 1 ? b.right : b.insideV;
    }

    let cellRPr: any = {};

    const applyConditional = (partType: string) => {
      const part = tblStylePr?.find((p: any) => p.type === partType);
      if (part) {
        if (part.tcPr?.shading?.fill) {
          cellShd = part.tcPr.shading.fill;
        }
        if (part.tcPr?.borders) {
          cellBorders = {
            ...cellBorders,
            ...part.tcPr.borders
          };
        }
        if (part.rPr) {
          cellRPr = {
            ...cellRPr,
            ...part.rPr
          };
        }
      }
    };

    const look = resolvedStyle.look || { firstRow: true, firstColumn: true, noHBand: false, noVBand: true };
    
    if (!look.noHBand) {
      if (r % 2 === 1) applyConditional('band1Horz');
      else applyConditional('band2Horz');
    }
    if (!look.noVBand) {
      if (c % 2 === 1) applyConditional('band1Vert');
      else applyConditional('band2Vert');
    }

    if (look.firstColumn && c === 0) {
      applyConditional('firstCol');
    }
    if (look.lastColumn && c === totalCols - 1) {
      applyConditional('lastCol');
    }
    if (look.firstRow && r === 0) {
      applyConditional('firstRow');
    }
    if (look.lastRow && r === totalRows - 1) {
      applyConditional('lastRow');
    }

    if (r === 0 && c === 0) applyConditional('nwCell');
    if (r === 0 && c === totalCols - 1) applyConditional('neCell');
    if (r === totalRows - 1 && c === 0) applyConditional('swCell');
    if (r === totalRows - 1 && c === totalCols - 1) applyConditional('seCell');

    const resolvedBorders = this.resolveBorderColors(cellBorders, theme);
    const resolvedShading = this.resolveThemeColor(cellShd, theme);
    
    return {
      borders: resolvedBorders,
      backgroundColor: resolvedShading?.rgb ? `#${resolvedShading.rgb}` : undefined,
      rPr: cellRPr
    };
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
      if (walkStyle.tblStylePr) {
         tblStylePr = this.mergeTblStylePr(walkStyle.tblStylePr, tblStylePr);
      }
      
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

                   const theme = this.editorRef?.getDocument?.()?.package?.theme;
                   const newMarks = this.createMarksFromRPr(resolved.rPr, schema, theme);
                   
                   const childNodes: PMNode[] = [];
                   target.node.forEach((childNode) => {
                      if (childNode.isText) {
                         let updatedMarks = childNode.marks;
                         const styleMarkNames = ['bold', 'italic', 'underline', 'strike', 'textColor', 'fontSize', 'fontFamily', 'highlight'];
                         updatedMarks = updatedMarks.filter(m => !styleMarkNames.includes(m.type.name));
                         updatedMarks = [...updatedMarks, ...newMarks];
                         childNodes.push(schema.text(childNode.text!, updatedMarks));
                      } else {
                         childNodes.push(childNode);
                      }
                   });
                   const newParaNode = schema.nodes.paragraph.create(newAttrs, childNodes);
                   tr = tr.replaceWith(target.pos, target.pos + target.node.nodeSize, newParaNode);
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

                   const theme = this.editorRef?.getDocument?.()?.package?.theme;
                   const totalRows = target.node.childCount;
                   let totalCols = 0;
                   if (totalRows > 0) {
                      const firstRow = target.node.child(0);
                      firstRow.forEach((cellNode) => {
                         totalCols += cellNode.attrs.colspan || 1;
                      });
                   }

                   const newRows: PMNode[] = [];
                   for (let r = 0; r < totalRows; r++) {
                      const rowNode = target.node.child(r);
                      const newCells: PMNode[] = [];
                      let currentColIdx = 0;
                      
                      for (let c = 0; c < rowNode.childCount; c++) {
                         const cellNode = rowNode.child(c);
                         const colspan = cellNode.attrs.colspan || 1;
                         
                         const cellFormat = this.resolveCellFormatting(r, currentColIdx, totalRows, totalCols, resolved, theme);
                         
                         const newCellAttrs = {
                            ...cellNode.attrs,
                            borders: cellFormat.borders,
                            backgroundColor: cellFormat.backgroundColor
                         };
                         
                         const newCellParagraphs: PMNode[] = [];
                         cellNode.forEach((pNode) => {
                            if (pNode.type.name === 'paragraph') {
                               const pAttrs = {
                                  ...pNode.attrs,
                                };
                               if (cellFormat.rPr && Object.keys(cellFormat.rPr).length > 0) {
                                  pAttrs.defaultTextFormatting = cellFormat.rPr;
                               }
                               
                               const newMarks = this.createMarksFromRPr(cellFormat.rPr, schema, theme);
                               const pChildren: PMNode[] = [];
                               pNode.forEach((childNode) => {
                                  if (childNode.isText) {
                                     let updatedMarks = childNode.marks;
                                     const styleMarkNames = ['bold', 'italic', 'underline', 'strike', 'textColor', 'fontSize', 'fontFamily', 'highlight'];
                                     updatedMarks = updatedMarks.filter(m => !styleMarkNames.includes(m.type.name));
                                     updatedMarks = [...updatedMarks, ...newMarks];
                                     pChildren.push(schema.text(childNode.text!, updatedMarks));
                                  } else {
                                     pChildren.push(childNode);
                                  }
                               });
                               newCellParagraphs.push(schema.nodes.paragraph.create(pAttrs, pChildren));
                            } else {
                               newCellParagraphs.push(pNode);
                            }
                         });
                         
                         newCells.push(cellNode.type.create(newCellAttrs, newCellParagraphs));
                         currentColIdx += colspan;
                      }
                      newRows.push(rowNode.type.create(rowNode.attrs, newCells));
                   }
                   
                   const newTableNode = target.node.type.create(newAttrs, newRows);
                   tr = tr.replaceWith(target.pos, target.pos + target.node.nodeSize, newTableNode);
                }
             } else {
                newAttrs.styleId = this.getStandardStyleId(styleId);
                tr = tr.setNodeMarkup(target.pos, null, newAttrs);
             }
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
          let marks: any[] = [];
          
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
                const theme = this.editorRef?.getDocument?.()?.package?.theme;
                marks = this.createMarksFromRPr(resolved.rPr, schema, theme);
             } else {
                pAttrs.styleId = this.getStandardStyleId(styleId);
             }
          }
          
          const pNode = schema.nodes.paragraph.create(pAttrs, text ? schema.text(text, marks) : undefined);
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

          const colWidth = Math.floor(9000 / cols);
          const columnWidths = Array(cols).fill(colWidth);
          const tableAttrs: any = { 
             columnWidths: columnWidths 
          };
          
          const theme = this.editorRef?.getDocument?.()?.package?.theme;
          const resolved = styleId ? this.resolveStyle(styleId) : null;
          
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
          } else if (styleId) {
             tableAttrs.styleId = this.getStandardStyleId(styleId);
          }
          
          const tableRows = [];
          for (let i = 0; i < rows; i++) {
            const cells = [];
            for (let j = 0; j < cols; j++) {
              let cellAttrs: any = {};
              let cellRPr: any = null;
              
              if (resolved) {
                const cellFormat = this.resolveCellFormatting(i, j, rows, cols, resolved, theme);
                cellAttrs.borders = cellFormat.borders;
                cellAttrs.backgroundColor = cellFormat.backgroundColor;
                cellRPr = cellFormat.rPr;
              }
              
              const textMarks = cellRPr ? this.createMarksFromRPr(cellRPr, schema, theme) : [];
              const textNode = schema.text(`Cell ${i},${j}`, textMarks);
              
              const pAttrs: any = { paraId: this.genParaId() };
              if (cellRPr && Object.keys(cellRPr).length > 0) {
                pAttrs.defaultTextFormatting = cellRPr;
              }
              const p = schema.nodes.paragraph.create(pAttrs, textNode);
              cells.push(cellType.create(cellAttrs, p));
            }
            tableRows.push(rowType.create({}, cells));
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
