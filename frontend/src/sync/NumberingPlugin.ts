import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';

export function getNumberString(value: number, format: string): string {
  if (format === 'lowerLetter') {
    return String.fromCharCode(96 + value); // 1 -> 'a'
  }
  if (format === 'upperLetter') {
    return String.fromCharCode(64 + value); // 1 -> 'A'
  }
  if (format === 'lowerRom') {
    return toRoman(value).toLowerCase();
  }
  if (format === 'upperRom') {
    return toRoman(value);
  }
  return value.toString();
}

export function toRoman(num: number): string {
  const lookup: [string, number][] = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
    ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
    ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]
  ];
  let roman = '';
  let temp = num;
  for (const [letter, value] of lookup) {
    while (temp >= value) {
      roman += letter;
      temp -= value;
    }
  }
  return roman;
}

export function formatLevelText(lvlText: string, levelValues: string[]): string {
  let result = lvlText;
  for (let i = 0; i < levelValues.length; i++) {
    result = result.replace(`%${i + 1}`, levelValues[i]);
  }
  return result;
}

export function cleanMarkerText(text: string, isBullet: boolean, ilvl: number): string {
  let cleaned = text;
  
  // Replace Wingdings/Symbol private use area characters with standard bullets
  cleaned = cleaned.replace(/[\uF000-\uF0FF]/g, (char) => {
    if (char === '\uF0B7' || char === '\uF02D' || char === '\uF0A7') {
      if (ilvl === 0) return '•';
      if (ilvl === 1) return '◦';
      return '▪';
    }
    return '•';
  });

  if (isBullet && (cleaned === '' || cleaned === 'o' || cleaned === '' || cleaned === '')) {
    if (ilvl === 0) return '•';
    if (ilvl === 1) return '◦';
    return '▪';
  }

  return cleaned;
}

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
    if (node.attrs.styleId) {
      extraAttrs['data-style-id'] = node.attrs.styleId;
    }
    if (node.attrs.look) {
      extraAttrs['data-look'] = typeof node.attrs.look === 'string'
        ? node.attrs.look
        : JSON.stringify(node.attrs.look);
    }
    if (node.attrs.tblLook) {
      extraAttrs['data-tbl-look'] = node.attrs.tblLook;
    }
    if (node.attrs.cellMargins) {
      extraAttrs['data-cell-margins'] = typeof node.attrs.cellMargins === 'string'
        ? node.attrs.cellMargins
        : JSON.stringify(node.attrs.cellMargins);
    }
    if (node.attrs._originalFormatting) {
      extraAttrs['data-original-formatting'] = typeof node.attrs._originalFormatting === 'string'
        ? node.attrs._originalFormatting
        : JSON.stringify(node.attrs._originalFormatting);
    }
    if (node.attrs.columnWidths) {
      extraAttrs['data-column-widths'] = typeof node.attrs.columnWidths === 'string'
        ? node.attrs.columnWidths
        : JSON.stringify(node.attrs.columnWidths);
    }
    if (node.attrs.width !== undefined && node.attrs.width !== null) {
      extraAttrs['data-width'] = String(node.attrs.width);
    }
    if (node.attrs.widthType) {
      extraAttrs['data-width-type'] = node.attrs.widthType;
    }
    if (node.attrs.justification) {
      extraAttrs['data-justification'] = node.attrs.justification;
    }
    if (node.attrs.tableLayout) {
      extraAttrs['data-table-layout'] = node.attrs.tableLayout;
    }
    if (node.attrs.floating) {
      extraAttrs['data-floating'] = typeof node.attrs.floating === 'string'
        ? node.attrs.floating
        : JSON.stringify(node.attrs.floating);
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
        const isTable = name === 'table' || name === 'tbl' || name === 'tableNode';
        if (isTable) {
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
