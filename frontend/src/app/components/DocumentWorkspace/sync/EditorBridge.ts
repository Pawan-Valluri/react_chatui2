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
    if (rPr.vertAlign && rPr.vertAlign === 'subscript' && schema.marks.subscript) {
      marks.push(schema.marks.subscript.create());
    }
    if (rPr.vertAlign && rPr.vertAlign === 'superscript' && schema.marks.superscript) {
      marks.push(schema.marks.superscript.create());
    }
    if (rPr.spacing) {
      if (schema.marks.tracking) {
        marks.push(schema.marks.tracking.create({ value: rPr.spacing }));
      } else if (schema.marks.letterSpacing) {
        marks.push(schema.marks.letterSpacing.create({ value: rPr.spacing }));
      }
    }
    if (rPr.caps && schema.marks.allCaps) {
      marks.push(schema.marks.allCaps.create());
    }
    if (rPr.smallCaps && schema.marks.smallCaps) {
      marks.push(schema.marks.smallCaps.create());
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
  /**
   * Helper to resolve cell borders, shading, and rPr based on position and look flags
   */
  private resolveCellFormatting(
    r: number,
    c: number,
    totalRows: number,
    totalCols: number,
    resolvedStyle: any,
    theme: any,
    lookMap?: any
  ) {
    if (!resolvedStyle) return { borders: undefined, backgroundColor: undefined, pPr: undefined, rPr: undefined };

    const { tblPr, tblStylePr } = resolvedStyle;
    
    let cellShd = tblPr?.shading?.fill;
    
    let cellBorders: any = {};
    const wrapBorder = (bVal: any) => bVal ? { ...bVal, specificity: 1 } : undefined;
    if (tblPr?.borders) {
      const b = tblPr.borders;
      cellBorders.top = r === 0 ? wrapBorder(b.top) : wrapBorder(b.insideH);
      cellBorders.bottom = r === totalRows - 1 ? wrapBorder(b.bottom) : wrapBorder(b.insideH);
      cellBorders.left = c === 0 ? wrapBorder(b.left) : wrapBorder(b.insideV);
      cellBorders.right = c === totalCols - 1 ? wrapBorder(b.right) : wrapBorder(b.insideV);
    }

    let cellRPr: any = { ...(resolvedStyle.rPr || {}) };
    let cellPPr: any = { ...(resolvedStyle.pPr || {}) };

    const applyConditional = (partType: string) => {
      const part = tblStylePr?.find((p: any) => p.type === partType);
      if (part) {
        if (part.tcPr?.shading?.fill) {
          cellShd = part.tcPr.shading.fill;
        }
        if (part.tcPr?.borders) {
          for (const side of ['top', 'bottom', 'left', 'right']) {
            if (part.tcPr.borders[side]) {
              cellBorders[side] = {
                ...part.tcPr.borders[side],
                specificity: 2
              };
            }
          }
        }
        if (part.pPr) {
          cellPPr = {
            ...cellPPr,
            ...part.pPr
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

    const look = lookMap || (resolvedStyle.tblPr?.tblLook?.val ? this.decodeTblLook(resolvedStyle.tblPr.tblLook.val) : {
      firstRow: true,
      firstColumn: true,
      lastRow: false,
      lastColumn: false,
      noHBand: false,
      noVBand: true
    });
    
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

    const resolvedShading = this.resolveThemeColor(cellShd, theme);
    
    return {
      borders: cellBorders,
      backgroundColor: resolvedShading?.rgb ? `#${resolvedShading.rgb}` : undefined,
      pPr: cellPPr,
      rPr: cellRPr
    };
  }

  private decodeTblLook(tblLookHex: string | undefined): {
    firstRow: boolean;
    lastRow: boolean;
    firstColumn: boolean;
    lastColumn: boolean;
    noHBand: boolean;
    noVBand: boolean;
  } {
    if (!tblLookHex) {
      return {
        firstRow: true,
        lastRow: false,
        firstColumn: true,
        lastColumn: false,
        noHBand: false,
        noVBand: true
      };
    }
    const val = parseInt(tblLookHex, 16);
    return {
      firstRow: (val & 0x0020) !== 0,
      lastRow: (val & 0x0040) !== 0,
      firstColumn: (val & 0x0080) !== 0,
      lastColumn: (val & 0x0100) !== 0,
      noHBand: (val & 0x0200) !== 0,
      noVBand: (val & 0x0400) !== 0,
    };
  }

  private compareBorders(borderA: any, borderB: any): any {
    const isNone = (b: any) => !b || b.val === 'nil' || b.val === 'none';
    if (isNone(borderA) && isNone(borderB)) return borderA || borderB;
    if (isNone(borderA)) return borderB;
    if (isNone(borderB)) return borderA;

    const szA = borderA.sz || 0;
    const szB = borderB.sz || 0;
    if (szA !== szB) {
      return szA > szB ? borderA : borderB;
    }

    const specA = borderA.specificity || 1;
    const specB = borderB.specificity || 1;
    if (specA !== specB) {
      return specA > specB ? borderA : borderB;
    }

    return borderA;
  }

  private resolveStyle(styleId: string | undefined): { pPr: any; rPr: any; tblPr: any; tblStylePr: any; actualStyleId: string } | null {
    return this.resolveStyleInternal(styleId, new Set<string>());
  }

  private resolveStyleInternal(styleId: string | undefined, visited: Set<string>): { pPr: any; rPr: any; tblPr: any; tblStylePr: any; actualStyleId: string } | null {
    if (!styleId) return null;
    
    const doc = this.editorRef?.getDocument?.();
    const styles = doc?.package?.styles?.styles || [];
    if (styles.length === 0) return null;
    
    const cleanId = styleId.toLowerCase().replace(/[\s_\-]+/g, '');
    
    let currentStyle = styles.find((s: any) => 
      s.styleId.toLowerCase() === cleanId || 
      (s.name && s.name.toLowerCase().replace(/[\s_\-]+/g, '') === cleanId)
    );
    
    if (!currentStyle) {
      currentStyle = styles.find((s: any) => {
        const sIdClean = s.styleId.toLowerCase().replace(/[\s_\-]+/g, '');
        const sNameClean = (s.name || '').toLowerCase().replace(/[\s_\-]+/g, '');
        return sIdClean.includes(cleanId) || sNameClean.includes(cleanId);
      });
    }
    
    if (!currentStyle) return null;
    if (visited.has(currentStyle.styleId)) return null;
    
    let pPr = {};
    let rPr = {};
    let tblPr = {};
    let tblStylePr: any[] = [];
    const actualStyleId = currentStyle.styleId;
    
    let walkStyle = currentStyle;
    
    while (walkStyle && !visited.has(walkStyle.styleId)) {
      visited.add(walkStyle.styleId);
      
      if (walkStyle.pPr) pPr = { ...walkStyle.pPr, ...pPr };
      if (walkStyle.rPr) rPr = { ...walkStyle.rPr, ...rPr };
      if (walkStyle.tblPr) tblPr = { ...walkStyle.tblPr, ...tblPr };
      if (walkStyle.tblStylePr) {
         tblStylePr = this.mergeTblStylePr(walkStyle.tblStylePr, tblStylePr);
      }

      if (walkStyle.link) {
         const linkedStyle = this.resolveStyleInternal(walkStyle.link, visited);
         if (linkedStyle && linkedStyle.rPr) {
            rPr = { ...linkedStyle.rPr, ...rPr };
         }
      }
      
      const parentId = walkStyle.basedOn;
      walkStyle = parentId ? styles.find((s: any) => s.styleId === parentId) : null;
    }
    
    return { pPr, rPr, tblPr, tblStylePr, actualStyleId };
  }

  private mapPPrToSchemaAttrs(pPr: any): any {
    const attrs: any = {};
    if (!pPr) return attrs;

    // 1. Direct schema-compliant properties
    const directKeys = [
      'spaceBefore', 'spaceAfter', 'lineSpacing', 'lineSpacingRule', 'spacingExplicit',
      'indentLeft', 'indentRight', 'indentFirstLine', 'hangingIndent',
      'borders', 'shading', 'tabs', 'pageBreakBefore', 'keepNext', 'keepLines',
      'contextualSpacing', 'numPr', 'numPrFromStyle', 'listNumFmt', 'listIsBullet'
    ];
    for (const key of directKeys) {
      if (pPr[key] !== undefined && pPr[key] !== null) {
        attrs[key] = pPr[key];
      }
    }

    // 2. Nested spacing properties (XML format)
    if (pPr.spacing) {
      if (pPr.spacing.before !== undefined && pPr.spacing.before !== null) {
        attrs.spaceBefore = parseInt(pPr.spacing.before, 10);
      }
      if (pPr.spacing.after !== undefined && pPr.spacing.after !== null) {
        attrs.spaceAfter = parseInt(pPr.spacing.after, 10);
      }
      if (pPr.spacing.line !== undefined && pPr.spacing.line !== null) {
        attrs.lineSpacing = parseInt(pPr.spacing.line, 10);
      }
    }

    // 3. Nested indent properties (XML format)
    const ind = pPr.indent || pPr.indents;
    if (ind) {
      if (ind.left !== undefined && ind.left !== null) {
        attrs.indentLeft = parseInt(ind.left, 10);
      }
      if (ind.right !== undefined && ind.right !== null) {
        attrs.indentRight = parseInt(ind.right, 10);
      }
      if (ind.firstLine !== undefined && ind.firstLine !== null) {
        attrs.indentFirstLine = parseInt(ind.firstLine, 10);
      }
      if (ind.hanging !== undefined && ind.hanging !== null) {
        attrs.hangingIndent = parseInt(ind.hanging, 10);
      }
    }

    // 4. Nested shading properties
    if (pPr.shading || pPr.shd) {
      attrs.shading = pPr.shading || pPr.shd;
    }

    // 5. Nested borders properties
    if (pPr.borders || pPr.pBdr) {
      attrs.borders = pPr.borders || pPr.pBdr;
    }

    return attrs;
  }

  /**
   * Helper to find a node by its ID attribute.
   */
  private findNodePosById(targetId: string): { pos: number; node: PMNode } | null {
    let result = null;
    this.view.state.doc.descendants((node, pos) => {
      if (node.attrs && (node.attrs.id === targetId || node.attrs.paraId === targetId)) {
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
                       ...this.mapPPrToSchemaAttrs(resolved.pPr)
                    };
                    if (Object.keys(resolved.rPr).length > 0) {
                       (cleanAttrs as any).defaultTextFormatting = resolved.rPr;
                    }
                    newAttrs = cleanAttrs;

                   const theme = this.editorRef?.getDocument?.()?.package?.theme;
                   const newStyleMarks = this.createMarksFromRPr(resolved.rPr, schema, theme);
                   
                   const oldStyleId = target.node.attrs.styleId || 'Normal';
                   const oldResolved = this.resolveStyle(oldStyleId);
                   
                   const childNodes: PMNode[] = [];
                   target.node.forEach((childNode) => {
                      if (childNode.isText) {
                         const originalMarks = childNode.marks;
                         const positiveOverrides: any[] = [];
                         const negativeOverrides = new Set<string>();
                         const styleMarkNames = ['bold', 'italic', 'underline', 'strike', 'textColor', 'fontSize', 'fontFamily', 'highlight', 'subscript', 'superscript', 'tracking', 'letterSpacing', 'allCaps', 'smallCaps'];
                         
                         this.diffStyleMarks(originalMarks, oldResolved, theme, positiveOverrides, negativeOverrides);
                         
                         // 1. Keep non-style marks (comments, links, etc.)
                         let finalMarks = originalMarks.filter(m => !styleMarkNames.includes(m.type.name));
                         
                         // 2. Merge style-derived marks from new style and positive/negative overrides
                         for (const newMark of newStyleMarks) {
                            if (!negativeOverrides.has(newMark.type.name)) {
                               const override = positiveOverrides.find(o => o.type.name === newMark.type.name);
                               if (override) {
                                  finalMarks.push(override);
                               } else {
                                  finalMarks.push(newMark);
                               }
                            }
                         }
                         
                         // 3. Apply remaining positive overrides not covered by newStyleMarks
                         for (const override of positiveOverrides) {
                            if (!finalMarks.some(f => f.type.name === override.type.name)) {
                               finalMarks.push(override);
                            }
                         }
                         
                         childNodes.push(schema.text(childNode.text!, finalMarks));
                      } else {
                         childNodes.push(childNode);
                      }
                   });
                   const newParaNode = schema.nodes.paragraph.create(newAttrs, childNodes);
                   tr = tr.replaceWith(target.pos, target.pos + target.node.nodeSize, newParaNode);
                } else if (target.node.type.name === 'table') {
                   const oldStyleId = target.node.attrs.styleId || 'NormalTable';
                   const oldResolved = this.resolveStyle(oldStyleId);
                   const oldTblLookHex = target.node.attrs.tblLook || (oldResolved?.tblPr as any)?.tblLook?.val;
                   const oldLookMap = this.decodeTblLook(oldTblLookHex);

                   newAttrs._originalFormatting = {
                      tblPr: resolved.tblPr,
                      tblStylePr: resolved.tblStylePr
                   };
                   const tblLookHex = target.node.attrs.tblLook || (resolved.tblPr as any)?.tblLook?.val;
                   const lookMap = this.decodeTblLook(tblLookHex);
                   newAttrs.look = lookMap;
                   newAttrs.tblLook = tblLookHex || "04A0";
                   
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

                   // 1. Build a 2D grid mapping each grid coordinate to its cellNode and cellFormat reference
                   const grid: any[][] = Array.from({ length: totalRows }, () => Array(totalCols).fill(null));
                   const cellNodeList: { cellNode: PMNode; r: number; c: number; colspan: number; rowspan: number; format: any }[] = [];
                   
                   for (let r = 0; r < totalRows; r++) {
                      const rowNode = target.node.child(r);
                      let currentColIdx = 0;
                      
                      for (let c = 0; c < rowNode.childCount; c++) {
                         while (currentColIdx < totalCols && grid[r][currentColIdx] !== null) {
                            currentColIdx++;
                         }
                         if (currentColIdx >= totalCols) break;

                         const cellNode = rowNode.child(c);
                         const colspan = cellNode.attrs.colspan || 1;
                         const rowspan = cellNode.attrs.rowspan || 1;
                         
                         const cellFormat = this.resolveCellFormatting(r, currentColIdx, totalRows, totalCols, resolved, theme, lookMap);
                         
                         // Merge cell node's own explicit borders with specificity 3
                         const cellNodeBorders = cellNode.attrs.borders;
                         if (cellNodeBorders) {
                            cellFormat.borders = cellFormat.borders || {};
                            for (const side of ['top', 'bottom', 'left', 'right']) {
                               if (cellNodeBorders[side]) {
                                  cellFormat.borders[side] = {
                                     ...cellNodeBorders[side],
                                     specificity: 3
                                  };
                               }
                            }
                         }
                         
                         const cellInfo = { cellNode, r, c: currentColIdx, colspan, rowspan, format: cellFormat };
                         cellNodeList.push(cellInfo);
                         
                         for (let ri = 0; ri < rowspan; ri++) {
                            for (let ci = 0; ci < colspan; ci++) {
                               if (r + ri < totalRows && currentColIdx + ci < totalCols) {
                                  grid[r + ri][currentColIdx + ci] = cellInfo;
                               }
                            }
                         }
                         
                         currentColIdx += colspan;
                      }
                   }

                   // 2. Perform border conflict tie-breaking for adjacent edges
                   for (let r = 0; r < totalRows; r++) {
                      for (let c = 0; c < totalCols; c++) {
                         const current = grid[r][c];
                         if (!current) continue;
                         
                         if (c + 1 < totalCols) {
                            const right = grid[r][c + 1];
                            if (right && right.cellNode !== current.cellNode) {
                               const borderA = current.format.borders?.right;
                               const borderB = right.format.borders?.left;
                               const winner = this.compareBorders(borderA, borderB);
                               
                               current.format.borders = current.format.borders || {};
                               right.format.borders = right.format.borders || {};
                               current.format.borders.right = winner;
                               right.format.borders.left = winner;
                            }
                         }
                         
                         if (r + 1 < totalRows) {
                            const bottom = grid[r + 1][c];
                            if (bottom && bottom.cellNode !== current.cellNode) {
                               const borderA = current.format.borders?.bottom;
                               const borderB = bottom.format.borders?.top;
                               const winner = this.compareBorders(borderA, borderB);
                               
                               current.format.borders = current.format.borders || {};
                               bottom.format.borders = bottom.format.borders || {};
                               current.format.borders.bottom = winner;
                               bottom.format.borders.top = winner;
                            }
                         }
                      }
                   }

                   // 3. Resolve border colors for the winning borders
                   for (const info of cellNodeList) {
                      info.format.borders = this.resolveBorderColors(info.format.borders, theme);
                   }

                   const newRows: PMNode[] = [];
                   for (let r = 0; r < totalRows; r++) {
                      const rowNode = target.node.child(r);
                      const newCells: PMNode[] = [];
                      
                      for (let c = 0; c < rowNode.childCount; c++) {
                         const cellNode = rowNode.child(c);
                         const info = cellNodeList.find(x => x.cellNode === cellNode);
                          const cellFormat = info ? info.format : { borders: undefined, backgroundColor: undefined, rPr: undefined, pPr: undefined };
                          const oldCellFormat = (oldResolved && info)
                             ? this.resolveCellFormatting(info.r, info.c, totalRows, totalCols, oldResolved, theme, oldLookMap)
                             : { borders: undefined, backgroundColor: undefined, rPr: undefined, pPr: undefined };
                          
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
                                
                                if (cellFormat.pPr && Object.keys(cellFormat.pPr).length > 0) {
                                   Object.assign(pAttrs, this.mapPPrToSchemaAttrs(cellFormat.pPr));
                                }
                                
                                if (cellFormat.rPr && Object.keys(cellFormat.rPr).length > 0) {
                                   pAttrs.defaultTextFormatting = cellFormat.rPr;
                                }
                                
                                const newMarks = this.createMarksFromRPr(cellFormat.rPr, schema, theme);
                                const pChildren: PMNode[] = [];
                                pNode.forEach((childNode) => {
                                   if (childNode.isText) {
                                      const originalMarks = childNode.marks;
                                      const positiveOverrides: any[] = [];
                                      const negativeOverrides = new Set<string>();
                                      const styleMarkNames = ['bold', 'italic', 'underline', 'strike', 'textColor', 'fontSize', 'fontFamily', 'highlight', 'subscript', 'superscript', 'tracking', 'letterSpacing', 'allCaps', 'smallCaps'];

                                      this.diffStyleMarks(originalMarks, { rPr: oldCellFormat.rPr }, theme, positiveOverrides, negativeOverrides);

                                      let finalMarks = originalMarks.filter(m => !styleMarkNames.includes(m.type.name));

                                      for (const newMark of newMarks) {
                                         if (!negativeOverrides.has(newMark.type.name)) {
                                            const override = positiveOverrides.find(o => o.type.name === newMark.type.name);
                                            if (override) {
                                               finalMarks.push(override);
                                            } else {
                                               finalMarks.push(newMark);
                                            }
                                         }
                                      }

                                      for (const override of positiveOverrides) {
                                         if (!finalMarks.some(f => f.type.name === override.type.name)) {
                                            finalMarks.push(override);
                                         }
                                      }

                                      pChildren.push(schema.text(childNode.text!, finalMarks));
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
                   ...this.mapPPrToSchemaAttrs(resolved.pPr)
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
          
          // 1. Resolve formatting for all cells
          const cellFormats: any[][] = [];
          const lookMap = resolved ? tableAttrs.look : undefined;
          
          for (let i = 0; i < rows; i++) {
             cellFormats.push([]);
             for (let j = 0; j < cols; j++) {
                if (resolved) {
                   cellFormats[i].push(this.resolveCellFormatting(i, j, rows, cols, resolved, theme, lookMap));
                } else {
                   cellFormats[i].push({ borders: undefined, backgroundColor: undefined, rPr: undefined, pPr: undefined });
                }
             }
          }
          
          // 2. Perform border conflict tie-breaking for adjacent edges
          for (let i = 0; i < rows; i++) {
             for (let j = 0; j < cols; j++) {
                const current = cellFormats[i][j];
                
                // Compare with right neighbor
                if (j + 1 < cols) {
                   const right = cellFormats[i][j + 1];
                   const winner = this.compareBorders(current.borders?.right, right.borders?.left);
                   current.borders = current.borders || {};
                   right.borders = right.borders || {};
                   current.borders.right = winner;
                   right.borders.left = winner;
                }
                
                // Compare with bottom neighbor
                if (i + 1 < rows) {
                   const bottom = cellFormats[i + 1][j];
                   const winner = this.compareBorders(current.borders?.bottom, bottom.borders?.top);
                   current.borders = current.borders || {};
                   bottom.borders = bottom.borders || {};
                   current.borders.bottom = winner;
                   bottom.borders.top = winner;
                }
             }
          }

          // 3. Resolve border colors for winning borders
          if (resolved) {
             for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                   cellFormats[i][j].borders = this.resolveBorderColors(cellFormats[i][j].borders, theme);
                }
             }
          }
          
          const tableRows = [];
          for (let i = 0; i < rows; i++) {
            const cells = [];
            for (let j = 0; j < cols; j++) {
              let cellAttrs: any = {};
              let cellRPr: any = null;
              let cellPPr: any = null;
              
              const cellFormat = cellFormats[i][j];
              if (resolved) {
                cellAttrs.borders = cellFormat.borders;
                cellAttrs.backgroundColor = cellFormat.backgroundColor;
                cellRPr = cellFormat.rPr;
                cellPPr = cellFormat.pPr;
              }
              
              const textMarks = cellRPr ? this.createMarksFromRPr(cellRPr, schema, theme) : [];
              const textNode = schema.text(`Cell ${i},${j}`, textMarks);
              
              const pAttrs: any = { paraId: this.genParaId() };
              if (cellPPr && Object.keys(cellPPr).length > 0) {
                 Object.assign(pAttrs, this.mapPPrToSchemaAttrs(cellPPr));
              }
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
          
          const isBullet = cleanStyleId?.toLowerCase().includes('bullet') || listStyleId?.toLowerCase().includes('bullet');
          const config = (window as any)._numberingConfig || {};
          const nums = config.nums || {};
          const abstractNums = config.abstractNums || {};
          
          let numId = isBullet ? '2' : '1';
          const targetFmt = isBullet ? 'bullet' : 'decimal';
          for (const key of Object.keys(nums)) {
             const absId = nums[key].abstractNumId;
             const absNum = abstractNums[absId];
             if (absNum && absNum['0'] && absNum['0'].numFmt === targetFmt) {
                numId = key;
                break;
             }
          }
          
          const paragraphs = items.map((text: string) => {
             const pAttrs = {
                paraId: this.genParaId(),
                numPr: {
                   numId: numId,
                   ilvl: 0
                },
                indentLeft: 720
             };
             return schema.nodes.paragraph.create(pAttrs, text ? schema.text(text) : undefined);
          });
          
          let currentInsertPos = insertPos;
          for (const pNode of paragraphs) {
             tr = tr.insert(currentInsertPos, pNode);
             currentInsertPos += pNode.nodeSize;
          }
          
          const emptyP = schema.nodes.paragraph.create({ paraId: this.genParaId() });
          tr = tr.insert(currentInsertPos, emptyP);
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

  /**
   * Helper to perform Comparative Mark Diffing on a set of original marks relative to the old style's resolved properties.
   */
  private diffStyleMarks(
    originalMarks: readonly any[],
    oldResolved: any,
    theme: any,
    positiveOverrides: any[],
    negativeOverrides: Set<string>
  ) {
    const oldRPr = oldResolved?.rPr || {};

    // 1. Check Bold
    const hasBoldMark = originalMarks.some(m => m.type.name === 'bold');
    const oldHasBold = !!oldRPr.bold;
    if (hasBoldMark && !oldHasBold) {
      const boldMark = originalMarks.find(m => m.type.name === 'bold');
      if (boldMark) positiveOverrides.push(boldMark);
    } else if (!hasBoldMark && oldHasBold) {
      negativeOverrides.add('bold');
    }

    // 2. Check Italic
    const hasItalicMark = originalMarks.some(m => m.type.name === 'italic');
    const oldHasItalic = !!oldRPr.italic;
    if (hasItalicMark && !oldHasItalic) {
      const italicMark = originalMarks.find(m => m.type.name === 'italic');
      if (italicMark) positiveOverrides.push(italicMark);
    } else if (!hasItalicMark && oldHasItalic) {
      negativeOverrides.add('italic');
    }

    // 3. Check Strike
    const hasStrikeMark = originalMarks.some(m => m.type.name === 'strike');
    const oldHasStrike = !!(oldRPr.strike || oldRPr.doubleStrike);
    if (hasStrikeMark && !oldHasStrike) {
      const strikeMark = originalMarks.find(m => m.type.name === 'strike');
      if (strikeMark) positiveOverrides.push(strikeMark);
    } else if (!hasStrikeMark && oldHasStrike) {
      negativeOverrides.add('strike');
    }

    // 4. Check Underline
    const underlineMark = originalMarks.find(m => m.type.name === 'underline');
    const oldUnderline = oldRPr.underline;
    if (underlineMark) {
      if (!oldUnderline) {
        positiveOverrides.push(underlineMark);
      } else {
        const oldStyle = typeof oldUnderline === 'object' ? oldUnderline.style : 'single';
        let oldColorVal = typeof oldUnderline === 'object' ? oldUnderline.color : undefined;
        if (oldColorVal) oldColorVal = this.resolveThemeColor(oldColorVal, theme)?.rgb;
        
        const markStyle = underlineMark.attrs.style || 'single';
        const markColor = underlineMark.attrs.color?.rgb || underlineMark.attrs.color;

        if (markStyle !== oldStyle || markColor !== oldColorVal) {
          positiveOverrides.push(underlineMark);
        }
      }
    } else if (oldUnderline) {
      negativeOverrides.add('underline');
    }

    // 5. Check Color (textColor)
    const textColorMark = originalMarks.find(m => m.type.name === 'textColor');
    const oldColor = oldRPr.color;
    if (textColorMark) {
      if (!oldColor) {
        positiveOverrides.push(textColorMark);
      } else {
        const oldColorVal = this.resolveThemeColor(oldColor, theme);
        const oldRgb = oldColorVal?.rgb;
        const oldThemeColor = oldColor.themeColor;
        const oldThemeTint = oldColor.themeTint;
        const oldThemeShade = oldColor.themeShade;

        const mAttrs = textColorMark.attrs;
        if (
          mAttrs.rgb !== oldRgb ||
          mAttrs.themeColor !== oldThemeColor ||
          mAttrs.themeTint !== oldThemeTint ||
          mAttrs.themeShade !== oldThemeShade
        ) {
          positiveOverrides.push(textColorMark);
        }
      }
    } else if (oldColor) {
      negativeOverrides.add('textColor');
    }

    // 6. Check Highlight
    const highlightMark = originalMarks.find(m => m.type.name === 'highlight');
    const oldHighlight = oldRPr.highlight;
    if (highlightMark) {
      if (!oldHighlight || highlightMark.attrs.color !== oldHighlight) {
        positiveOverrides.push(highlightMark);
      }
    } else if (oldHighlight) {
      negativeOverrides.add('highlight');
    }

    // 7. Check FontSize
    const fontSizeMark = originalMarks.find(m => m.type.name === 'fontSize');
    const oldFontSize = oldRPr.fontSize;
    if (fontSizeMark) {
      if (!oldFontSize || fontSizeMark.attrs.size !== oldFontSize) {
        positiveOverrides.push(fontSizeMark);
      }
    } else if (oldFontSize) {
      negativeOverrides.add('fontSize');
    }

    // 8. Check FontFamily
    const fontFamilyMark = originalMarks.find(m => m.type.name === 'fontFamily');
    const oldFontFamily = oldRPr.fontFamily;
    if (fontFamilyMark) {
      if (!oldFontFamily) {
        positiveOverrides.push(fontFamilyMark);
      } else {
        const oldAscii = oldFontFamily.ascii;
        const oldHAnsi = oldFontFamily.hAnsi ?? oldFontFamily.ascii;
        const oldAsciiTheme = oldFontFamily.asciiTheme;

        const mAttrs = fontFamilyMark.attrs;
        if (
          mAttrs.ascii !== oldAscii ||
          mAttrs.hAnsi !== oldHAnsi ||
          mAttrs.asciiTheme !== oldAsciiTheme
        ) {
          positiveOverrides.push(fontFamilyMark);
        }
      }
    } else if (oldFontFamily) {
      negativeOverrides.add('fontFamily');
    }

    // 9. Check Subscript/Superscript (vertAlign)
    const hasSubscriptMark = originalMarks.some(m => m.type.name === 'subscript');
    const oldHasSubscript = oldRPr.vertAlign === 'subscript';
    if (hasSubscriptMark && !oldHasSubscript) {
      const subMark = originalMarks.find(m => m.type.name === 'subscript');
      if (subMark) positiveOverrides.push(subMark);
    } else if (!hasSubscriptMark && oldHasSubscript) {
      negativeOverrides.add('subscript');
    }

    const hasSuperscriptMark = originalMarks.some(m => m.type.name === 'superscript');
    const oldHasSuperscript = oldRPr.vertAlign === 'superscript';
    if (hasSuperscriptMark && !oldHasSuperscript) {
      const superMark = originalMarks.find(m => m.type.name === 'superscript');
      if (superMark) positiveOverrides.push(superMark);
    } else if (!hasSuperscriptMark && oldHasSuperscript) {
      negativeOverrides.add('superscript');
    }

    // 10. Check Spacing (tracking/letterSpacing)
    const trackingMark = originalMarks.find(m => m.type.name === 'tracking' || m.type.name === 'letterSpacing');
    const oldSpacing = oldRPr.spacing;
    if (trackingMark) {
      if (!oldSpacing || trackingMark.attrs.value !== oldSpacing) {
        positiveOverrides.push(trackingMark);
      }
    } else if (oldSpacing) {
      negativeOverrides.add(trackingMark?.type.name || 'tracking');
    }

    // 11. Check Caps (allCaps / smallCaps)
    const hasAllCapsMark = originalMarks.some(m => m.type.name === 'allCaps');
    const oldHasAllCaps = !!oldRPr.caps;
    if (hasAllCapsMark && !oldHasAllCaps) {
      const capsMark = originalMarks.find(m => m.type.name === 'allCaps');
      if (capsMark) positiveOverrides.push(capsMark);
    } else if (!hasAllCapsMark && oldHasAllCaps) {
      negativeOverrides.add('allCaps');
    }

    const hasSmallCapsMark = originalMarks.some(m => m.type.name === 'smallCaps');
    const oldHasSmallCaps = !!oldRPr.smallCaps;
    if (hasSmallCapsMark && !oldHasSmallCaps) {
      const smallCapsMark = originalMarks.find(m => m.type.name === 'smallCaps');
      if (smallCapsMark) positiveOverrides.push(smallCapsMark);
    } else if (!hasSmallCapsMark && oldHasSmallCaps) {
      negativeOverrides.add('smallCaps');
    }
  }
}
