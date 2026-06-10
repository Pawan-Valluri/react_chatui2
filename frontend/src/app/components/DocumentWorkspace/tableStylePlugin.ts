import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const createTableStylePlugin = () => {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'table') {
            const styleId = node.attrs.styleId;
            if (styleId) {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  'data-style-id': styleId,
                  class: `docx-style-${styleId}` // Add both just in case
                })
              );
            }
          }
        });

        return DecorationSet.create(state.doc, decorations);
      }
    }
  });
};
