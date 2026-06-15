import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';


function computeDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph') {
      const attrs = node.attrs;
      let styleParts: string[] = [];

      const isInsideCell = parent && (parent.type.name === 'table_cell' || parent.type.name === 'tableCell' || parent.type.name === 'tc');
      const isListItem = !!attrs.numPr;

      // Spacing: spaceBefore, spaceAfter, lineSpacing
      if (attrs.spaceBefore !== undefined && attrs.spaceBefore !== null) {
        styleParts.push(`margin-top: ${attrs.spaceBefore / 20}pt`);
      }
      if (attrs.spaceAfter !== undefined && attrs.spaceAfter !== null) {
        styleParts.push(`margin-bottom: ${attrs.spaceAfter / 20}pt`);
      }
      if (attrs.lineSpacing !== undefined && attrs.lineSpacing !== null) {
        styleParts.push(`line-height: ${attrs.lineSpacing / 240}`);
      }

      // Indents: indentLeft, indentRight, indentFirstLine, hangingIndent
      let indentLeft = typeof attrs.indentLeft === 'number' ? attrs.indentLeft : undefined;
      let hangingIndent = typeof attrs.hangingIndent === 'number' ? attrs.hangingIndent : undefined;
      let indentFirstLine = typeof attrs.indentFirstLine === 'number' ? attrs.indentFirstLine : undefined;
      let indentRight = typeof attrs.indentRight === 'number' ? attrs.indentRight : undefined;

      // Only apply paragraph margins and indents inline if this is NOT a list item
      if (!isListItem) {
        if (indentLeft !== undefined) {
          styleParts.push(`margin-left: ${indentLeft / 20}pt`);
        }
        if (indentRight !== undefined) {
          styleParts.push(`margin-right: ${indentRight / 20}pt`);
        }
        if (indentFirstLine !== undefined) {
          styleParts.push(`text-indent: ${indentFirstLine / 20}pt`);
        } else if (hangingIndent !== undefined) {
          styleParts.push(`text-indent: -${hangingIndent / 20}pt`);
        }
      }

      // Shading: shading (skip paragraph-level background if we are inside a table cell)
      if (attrs.shading && !isInsideCell) {
        const fill = attrs.shading.fill || attrs.shading.color;
        if (fill && fill !== 'auto' && fill !== 'clear') {
          const hex = fill.startsWith('#') ? fill : `#${fill}`;
          styleParts.push(`background-color: ${hex}`);
        }
      }

      // Borders: borders
      if (attrs.borders) {
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const border = attrs.borders[side];
          if (border && border.val !== 'nil' && border.val !== 'none') {
            const width = (border.sz || 4) / 8;
            const color = border.color && border.color !== 'auto' ? (border.color.startsWith('#') ? border.color : `#${border.color}`) : 'black';
            const styleType = border.val === 'double' ? 'double' : 'solid';
            styleParts.push(`border-${side}: ${width}pt ${styleType} ${color}`);
            const space = border.space || 0;
            if (space > 0) {
              styleParts.push(`padding-${side}: ${space}pt`);
            }
          }
        }
      }

      let decosProps: any = {};
      if (styleParts.length > 0) {
        decosProps.style = styleParts.join('; ') + ';';
      }
      if (isListItem) {
        decosProps['data-list-marker'] = 'true';
      }
      if (Object.keys(decosProps).length > 0) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, decosProps));
      }
    }
    return true;
  });

  return DecorationSet.create(doc, decos);
}

function wrapTableToDOM(originalToDOM: any) {
  return function(node: any) {
    const result = originalToDOM(node);
    if (!result) return result;

    const extraAttrs: Record<string, string> = {};

    // Dump all node attributes exactly as they are named (and their lowercase versions)
    Object.keys(node.attrs).forEach(key => {
      const val = node.attrs[key];
      if (val !== undefined && val !== null) {
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        extraAttrs[key] = strVal;
        extraAttrs[key.toLowerCase()] = strVal;
      }
    });

    // Explicitly unwrap _originalFormatting properties just in case the exporter expects them at the top level
    if (node.attrs._originalFormatting) {
      try {
        const orig = typeof node.attrs._originalFormatting === 'string'
          ? JSON.parse(node.attrs._originalFormatting)
          : node.attrs._originalFormatting;
          
        if (orig.tblPr) {
          const tblPrStr = JSON.stringify(orig.tblPr);
          extraAttrs['tblPr'] = tblPrStr;
          extraAttrs['tblpr'] = tblPrStr;
        }
        if (orig.tblStylePr) {
          const tblStylePrStr = JSON.stringify(orig.tblStylePr);
          extraAttrs['tblStylePr'] = tblStylePrStr;
          extraAttrs['tblstylepr'] = tblStylePrStr;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    if (result && typeof result.setAttribute === 'function') {
      Object.entries(extraAttrs).forEach(([k, v]) => {
        result.setAttribute(k, v);
      });
      return result;
    }

    if (Array.isArray(result)) {
      const tag = result[0];
      let attrs = result[1];
      let hasAttrs = true;

      if (
        attrs === 0 ||
        Array.isArray(attrs) ||
        (attrs && typeof attrs.setAttribute === 'function') ||
        typeof attrs !== 'object' ||
        attrs === null
      ) {
        attrs = {};
        hasAttrs = false;
      }

      const mergedAttrs = { ...attrs, ...extraAttrs };

      if (hasAttrs) {
        const newResult = [...result];
        newResult[1] = mergedAttrs;
        return newResult;
      } else {
        return [tag, mergedAttrs, ...result.slice(1)];
      }
    }

    return result;
  };
}

export const docxStylingAndNumberingPlugin = new Plugin({
  state: {
    init(_config, state) {
      const schema = state.schema;
      Object.keys(schema.nodes).forEach((name) => {
        const isTableNode = [
          'table', 'tbl', 'tableNode',
          'table_row', 'tableRow', 'tr',
          'table_cell', 'tableCell', 'tc'
        ].includes(name);
        
        if (isTableNode) {
          const nodeType = schema.nodes[name];
          if (nodeType && nodeType.spec && nodeType.spec.toDOM && !(nodeType.spec.toDOM as any).__wrapped) {
            const original = nodeType.spec.toDOM;
            nodeType.spec.toDOM = wrapTableToDOM(original);
            (nodeType.spec.toDOM as any).__wrapped = true;
            if (schema.cached) {
              schema.cached.domSerializer = null;
            }
          }
        }
      });
      return computeDecos(state.doc);
    },
    apply(tr, oldDecos, _oldState, newState) {
      if (tr.docChanged) {
        return computeDecos(newState.doc);
      }
      return oldDecos.map(tr.mapping, tr.doc);
    }
  },
  props: {
    decorations(state) {
      return this.getState(state);
    }
  },
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    let tr = newState.tr;
    let modified = false;
    newState.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs.numPr) {
        const ilvl = node.attrs.numPr.ilvl !== undefined ? node.attrs.numPr.ilvl : 0;
        let updates: any = null;
        if (node.attrs.indentLeft === undefined || node.attrs.indentLeft === null) {
          updates = updates || {};
          updates.indentLeft = (ilvl + 1) * 720;
        }
        if (node.attrs.hangingIndent === undefined || node.attrs.hangingIndent === null || node.attrs.hangingIndent === false) {
          if (node.attrs.indentFirstLine === undefined || node.attrs.indentFirstLine === null) {
            updates = updates || {};
            updates.hangingIndent = 360;
          }
        }
        if (updates) {
          const newAttrs = { ...node.attrs, ...updates };
          tr = tr.setNodeMarkup(pos, null, newAttrs);
          modified = true;
        }
      }
    });
    return modified ? tr : null;
  }
});
