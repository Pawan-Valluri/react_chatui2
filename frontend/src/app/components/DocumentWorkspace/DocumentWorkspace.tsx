import React, { useRef, useEffect, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useDocxAgentTools } from "@eigenpal/docx-editor-agents/react";
import { useDocumentSync } from "./useDocumentSync";
import { DocxEditorWrapper } from "./DocxEditorWrapper";
import "./DocumentWorkspace.scss";
import paragraphStylesMd from "../../assets/styles/paragraph_styles.md?raw";
import tableStylesMd from "../../assets/styles/table_styles.md?raw";

interface DocumentWorkspaceProps {
  threadId: string;
  userProfile?: any;
  width: number;
  documentRevision: number;
  onRegisterAgentTools?: (tools: any) => void;
  onSavingStatusChange?: (status: any) => void;
}

export const DocumentWorkspace: React.FC<DocumentWorkspaceProps> = ({
  threadId,
  userProfile,
  width,
  onRegisterAgentTools,
  onSavingStatusChange,
}) => {
  const editorRef = useRef<any>(null);
  
  const {
    documentBuffer,
    loading,
    savingStatus,
    error,
    handleLocalChange,
  } = useDocumentSync({
    threadId,
    editorRef,
  });

  const userName = userProfile?.fullname || userProfile?.uid || "Beyond Developer";

  // Custom tools for advanced table editing and formatting
  const customTools = useMemo(() => {
    const getPosForParaId = (view: any, cleanParaId: string) => {
      let targetIndex = -1;
      if (cleanParaId === 'p_first' || cleanParaId === '0') targetIndex = 0;
      else if (cleanParaId === 'p_second' || cleanParaId === '1') targetIndex = 1;
      else if (cleanParaId === 'p_third' || cleanParaId === '2') targetIndex = 2;

      let pos = -1;
      let currentIndex = 0;
      view.state.doc.descendants((node: any, nodePos: number) => {
        if (node.type.name === 'paragraph') {
          if (targetIndex !== -1 && currentIndex === targetIndex) {
            pos = nodePos;
            return false;
          }
          if (node.attrs && node.attrs.paraId === cleanParaId) {
            pos = nodePos;
            return false;
          }
          currentIndex++;
        }
        return true;
      });
      return pos;
    };

    return {
      insert_table: {
        name: 'insert_table',
        displayName: 'Inserting table',
        description: 'Insert a table into the document after the paragraph specified by paraId.\n\n' + tableStylesMd,
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' },
            rows: { type: 'number' },
            cols: { type: 'number' },
            styleId: { type: 'string' },
            cells: { type: 'array', items: { type: 'array', items: { type: 'object' } } }
          },
          required: ['paraId', 'rows', 'cols']
        },
        handler: (input: any) => {
          console.log("insert_table called with:", input);
          
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ID ${input.paraId} not found.` };
          
          const { schema } = view.state;
          console.log("TABLE SCHEMA ATTRS:", schema.nodes.table.spec.attrs);
          const rowNodes = [];
          const generateId = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
          
          for (let r = 0; r < input.rows; r++) {
            const cellNodes = [];
            for (let c = 0; c < input.cols; c++) {
              const cellData = (input.cells && input.cells[r] && input.cells[r][c]) || {};
              const contentItems = cellData.content || [];
              
              const blockNodes = [];
              if (contentItems.length === 0) {
                blockNodes.push(schema.node("paragraph", { paraId: generateId() }));
              } else {
                for (const item of contentItems) {
                  if (item.type === "paragraph") {
                    const marksList = [];
                    if (item.marks?.bold && schema.marks.bold) marksList.push(schema.marks.bold.create());
                    if (item.marks?.italic && schema.marks.italic) marksList.push(schema.marks.italic.create());
                    if (item.marks?.color && schema.marks.textColor) {
                      marksList.push(schema.marks.textColor.create({ rgb: item.marks.color.replace("#", "") }));
                    }
                    const textNode = item.text ? schema.text(item.text, marksList) : null;
                    blockNodes.push(schema.node("paragraph", { paraId: generateId() }, textNode));
                  } else if (item.type === "bullet_list") {
                    const listItems = (item.items || []).map((liText: string) => {
                      return schema.node("paragraph", { 
                        paraId: generateId(), 
                        styleId: "ListBullet" 
                      }, liText ? schema.text(liText) : null);
                    });
                    blockNodes.push(...listItems);
                  }
                }
              }
              
              const cellWidth = Math.floor(9360 / input.cols);
              
              const cellAttrs: any = { 
                colspan: 1, 
                rowspan: 1, 
                colwidth: null,
                width: cellWidth,
                widthType: "dxa"
              };
              
              cellNodes.push(schema.node("tableCell", cellAttrs, blockNodes));
            }
            rowNodes.push(schema.node("tableRow", { height: 360, heightRule: "atLeast" }, cellNodes));
          }
          
          const cleanStyleId = input.styleId ? input.styleId.replace(/\s+/g, '') : "TableGrid";
          const tableAttrs: any = { 
            styleId: cleanStyleId, 
            width: 9360,
            widthType: "dxa",
            columnWidths: Array(input.cols).fill(Math.floor(9360 / input.cols))
          };
          const tableNode = schema.node("table", tableAttrs, rowNodes);
          const emptyParaNode = schema.node("paragraph", { paraId: generateId() });
          
          const targetNode = view.state.doc.nodeAt(pos);
          if (!targetNode) return { success: false, error: 'Target paragraph node not found.' };
          
          const insertPos = pos + targetNode.nodeSize;
          const tr = view.state.tr.insert(insertPos, [tableNode, emptyParaNode]);
          view.dispatch(tr);
          
          return { success: true, data: `Table inserted successfully after ${input.paraId}.` };
        }
      },
      
      edit_table_cell: {
        name: 'edit_table_cell',
        displayName: 'Editing table cell',
        description: 'Update the background color and contents of a table cell containing a target paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' },
            shading: { type: 'string' },
            content: { type: 'array', items: { type: 'object' } }
          },
          required: ['paraId']
        },
        handler: (input: any) => {
          console.log("edit_table_cell called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ID ${input.paraId} not found.` };
          
          let cellPos = -1;
          let cellNode: any = null;
          
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'tableCell') {
              cellPos = $pos.before(d);
              cellNode = node;
              break;
            }
          }
          
          if (cellPos === -1 || !cellNode) {
            return { success: false, error: `Paragraph ${input.paraId} is not inside a table cell.` };
          }
          
          const { schema } = view.state;
          console.log("TABLE SCHEMA ATTRS:", schema.nodes.table.spec.attrs);
          const blockNodes = [];
          const generateId = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
          
          if (input.content) {
            for (const item of input.content) {
              if (item.type === "paragraph") {
                const marksList = [];
                if (item.marks?.bold && schema.marks.bold) marksList.push(schema.marks.bold.create());
                if (item.marks?.italic && schema.marks.italic) marksList.push(schema.marks.italic.create());
                if (item.marks?.color && schema.marks.textColor) {
                  marksList.push(schema.marks.textColor.create({ rgb: item.marks.color.replace("#", "") }));
                }
                const textNode = item.text ? schema.text(item.text, marksList) : null;
                blockNodes.push(schema.node("paragraph", { paraId: generateId() }, textNode));
              } else if (item.type === "bullet_list") {
                const listItems = (item.items || []).map((liText: string) => {
                  return schema.node("paragraph", { 
                    paraId: generateId(), 
                    styleId: "ListBullet" 
                  }, liText ? schema.text(liText) : null);
                });
                blockNodes.push(...listItems);
              }
            }
          }
          
          let tr = view.state.tr;
          const cellAttrs = { ...cellNode.attrs };
          if (input.shading) {
            cellAttrs.shading = { fill: input.shading.replace("#", "") };
          }
          
          const newCellNode = schema.node(
            "tableCell",
            cellAttrs,
            blockNodes.length > 0 ? blockNodes : cellNode.content
          );
          
          tr = tr.replaceWith(cellPos, cellPos + cellNode.nodeSize, newCellNode);
          view.dispatch(tr);
          
          return { success: true, data: `Table cell updated successfully.` };
        }
      },
      
      toggle_bullet_list: {
        name: 'toggle_bullet_list',
        displayName: 'Toggling bullet list',
        description: 'Convert a paragraph to a bullet point list item or normal paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' },
            enabled: { type: 'boolean' }
          },
          required: ['paraId', 'enabled']
        },
        handler: (input: any) => {
          console.log("toggle_bullet_list called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          const targetNode = pos !== -1 ? view.state.doc.nodeAt(pos) : null;
          
          if (pos === -1 || !targetNode) {
            return { success: false, error: `Paragraph ID ${input.paraId} not found.` };
          }
          
          const styleId = input.enabled ? "ListBullet" : "Normal";
          const newAttrs = { ...targetNode.attrs, styleId };
          
          const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs);
          view.dispatch(tr);
          
          return { success: true, data: `Converted paragraph ${input.paraId} to style ${styleId}.` };
        }
      },
      
      add_table_row: {
        name: 'add_table_row',
        displayName: 'Adding table row',
        description: 'Add a new row to the table containing the paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' },
            position: { type: 'string', enum: ['before', 'after'] }
          },
          required: ['paraId']
        },
        handler: (input: any) => {
          console.log("add_table_row called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ${input.paraId} not found.` };
          
          let rowPos = -1;
          let rowNode: any = null;
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'tableRow') {
              rowPos = $pos.before(d);
              rowNode = node;
              break;
            }
          }
          
          if (rowPos === -1 || !rowNode) {
            // Search forward using nodesBetween to guarantee we find the table
            const node = view.state.doc.nodeAt(pos);
            const searchLimit = node ? pos + node.nodeSize + 100 : pos + 100;
            let foundTablePos = -1;
            let foundTableNode: any = null;
            view.state.doc.nodesBetween(pos, Math.min(searchLimit, view.state.doc.content.size), (n: any, p: any) => {
              if (n.type.name === 'table' && foundTablePos === -1) {
                foundTablePos = p;
                foundTableNode = n;
                return false;
              }
              return true;
            });
            
            if (foundTablePos !== -1 && foundTableNode) {
              const firstRow = foundTableNode.firstChild;
              if (firstRow && firstRow.type.name === 'tableRow') {
                rowPos = foundTablePos + 1; // start of table
                rowNode = firstRow;
                if (input.position === 'after') {
                  const lastRow = foundTableNode.lastChild;
                  if (lastRow) {
                    rowPos = foundTablePos + foundTableNode.nodeSize - lastRow.nodeSize - 1;
                    rowNode = lastRow;
                  }
                }
              }
            }
          }
          
          if (rowPos === -1 || !rowNode) {
            return { success: false, error: `Paragraph ${input.paraId} is not inside a table.` };
          }
          
          const { schema } = view.state;
          console.log("TABLE SCHEMA ATTRS:", schema.nodes.table.spec.attrs);
          const cells = [];
          const generateId = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
          
          for (let i = 0; i < rowNode.childCount; i++) {
            const currentCell = rowNode.child(i);
            const pNode = schema.node("paragraph", { paraId: generateId() });
            cells.push(schema.node("tableCell", { shading: currentCell.attrs.shading }, pNode));
          }
          
          const newRowNode = schema.node("tableRow", {}, cells);
          const insertPos = input.position === 'before' ? rowPos : rowPos + rowNode.nodeSize;
          
          const tr = view.state.tr.insert(insertPos, newRowNode);
          view.dispatch(tr);
          
          return { success: true, data: `New row inserted ${input.position || 'after'} current row.` };
        }
      },
      
      delete_table_row: {
        name: 'delete_table_row',
        displayName: 'Deleting table row',
        description: 'Delete the table row containing the paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' }
          },
          required: ['paraId']
        },
        handler: (input: any) => {
          console.log("delete_table_row called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ${input.paraId} not found.` };
          
          let rowPos = -1;
          let rowNode: any = null;
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'tableRow') {
              rowPos = $pos.before(d);
              rowNode = node;
              break;
            }
          }
          
          if (rowPos === -1 || !rowNode) {
            return { success: false, error: `Paragraph ${input.paraId} is not inside a table.` };
          }
          
          const tr = view.state.tr.delete(rowPos, rowPos + rowNode.nodeSize);
          view.dispatch(tr);
          
          return { success: true, data: `Row deleted successfully.` };
        }
      },
      
      add_table_column: {
        name: 'add_table_column',
        displayName: 'Adding table column',
        description: 'Add a new column to the table containing the paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' },
            position: { type: 'string', enum: ['before', 'after'] }
          },
          required: ['paraId']
        },
        handler: (input: any) => {
          console.log("add_table_column called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ${input.paraId} not found.` };
          
          const $pos = view.state.doc.resolve(pos);
          let cellDepth = -1;
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'tableCell') {
              cellDepth = d;
              break;
            }
          }
          
          if (cellDepth === -1) {
            return { success: false, error: `Paragraph ${input.paraId} is not inside a table.` };
          }
          
          const cellIndex = $pos.index(cellDepth - 1);
          
          let tablePos = -1;
          let tableNode: any = null;
          for (let d = cellDepth - 2; d >= 0; d--) {
            if ($pos.node(d).type.name === 'table') {
              tablePos = $pos.before(d);
              tableNode = $pos.node(d);
              break;
            }
          }
          
          if (tablePos === -1 || !tableNode) {
            return { success: false, error: `Table wrapper not found.` };
          }
          
          const { schema } = view.state;
          console.log("TABLE SCHEMA ATTRS:", schema.nodes.table.spec.attrs);
          const generateId = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
          let tr = view.state.tr;
          let offset = 0;
          
          tableNode.forEach((rowNode: any, rowOffset: number) => {
            let colIndex = input.position === 'before' ? cellIndex : cellIndex + 1;
            let insertPos = tablePos + 1 + rowOffset + 1;
            
            for (let i = 0; i < colIndex; i++) {
              if (i < rowNode.childCount) {
                insertPos += rowNode.child(i).nodeSize;
              }
            }
            
            const pNode = schema.node("paragraph", { paraId: generateId() });
            const cellNode = schema.node("tableCell", {}, pNode);
            
            tr = tr.insert(insertPos + offset, cellNode);
            offset += cellNode.nodeSize;
          });
          
          view.dispatch(tr);
          return { success: true, data: `New column inserted ${input.position || 'after'} column ${cellIndex + 1}.` };
        }
      },
      
      delete_table_column: {
        name: 'delete_table_column',
        displayName: 'Deleting table column',
        description: 'Delete the table column containing the paragraph.',
        inputSchema: {
          type: 'object',
          properties: {
            paraId: { type: 'string' }
          },
          required: ['paraId']
        },
        handler: (input: any) => {
          console.log("delete_table_column called with:", input);
          const cleanParaId = input.paraId ? input.paraId.replace(/[\[\]]/g, '') : '';
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const pos = getPosForParaId(view, cleanParaId);
          
          if (pos === -1) return { success: false, error: `Paragraph ${input.paraId} not found.` };
          
          const $pos = view.state.doc.resolve(pos);
          let cellDepth = -1;
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'tableCell') {
              cellDepth = d;
              break;
            }
          }
          
          if (cellDepth === -1) {
            return { success: false, error: `Paragraph ${input.paraId} is not inside a table.` };
          }
          
          const cellIndex = $pos.index(cellDepth - 1);
          
          let tablePos = -1;
          let tableNode: any = null;
          for (let d = cellDepth - 2; d >= 0; d--) {
            if ($pos.node(d).type.name === 'table') {
              tablePos = $pos.before(d);
              tableNode = $pos.node(d);
              break;
            }
          }
          
          if (tablePos === -1 || !tableNode) {
            return { success: false, error: `Table wrapper not found.` };
          }
          
          let tr = view.state.tr;
          let offset = 0;
          
          tableNode.forEach((rowNode: any, rowOffset: number) => {
            if (cellIndex < rowNode.childCount) {
              let cellPos = tablePos + 1 + rowOffset + 1;
              for (let i = 0; i < cellIndex; i++) {
                cellPos += rowNode.child(i).nodeSize;
              }
              const cellNodeSize = rowNode.child(cellIndex).nodeSize;
              tr = tr.delete(cellPos - offset, cellPos - offset + cellNodeSize);
              offset += cellNodeSize;
            }
          });
          
          view.dispatch(tr);
          return { success: true, data: `Column deleted successfully.` };
        }
      },
      
      append_paragraph: {
        name: 'append_paragraph',
        displayName: 'Appending paragraph',
        description: 'Append a new paragraph to the end of the document.\n\n' + paragraphStylesMd,
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            styleId: { type: 'string' }
          },
          required: ['text']
        },
        handler: (input: any) => {
          console.log("append_paragraph called with:", input);
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: 'Editor view not available.' };
          
          const { schema } = view.state;
          console.log("TABLE SCHEMA ATTRS:", schema.nodes.table.spec.attrs);
          const generateId = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
          
          const attrs: any = { paraId: generateId() };
          if (input.styleId) attrs.styleId = input.styleId.replace(/\s+/g, '');
          
          const pNode = schema.node("paragraph", attrs, input.text ? schema.text(input.text) : null);
          
          const tr = view.state.tr.insert(view.state.doc.content.size, pNode);
          view.dispatch(tr);
          
          if (input.styleId && editorRef.current) {
            editorRef.current.setParagraphStyle({
              paraId: attrs.paraId,
              styleId: attrs.styleId
            });
          }
          
          return { success: true, data: `Paragraph appended successfully.` };
        }
      }
    };
  }, []);

  const { executeToolCall, getContext } = useDocxAgentTools({
    editorRef,
    author: userName,
    tools: customTools,
  });

  // Propagate agent tools on mount/change
  useEffect(() => {
    let lastDocStr = "";
    const interval = setInterval(() => {
      const view = editorRef.current?.getEditorRef()?.getView();
      if (view) {
        try {
          const docStr = JSON.stringify(view.state.doc.toJSON());
          if (docStr !== lastDocStr && docStr.includes('"type":"table"')) {
            lastDocStr = docStr;
            fetch('http://localhost:8080/api/debug_schema', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: docStr
            }).catch(e => console.log('debug json failed', e));
          }
        } catch(e) {}
      }
    }, 2000);

    if (onRegisterAgentTools) {
      onRegisterAgentTools({ executeToolCall, getContext });
    }
    return () => {
      clearInterval(interval);
      if (onRegisterAgentTools) {
        onRegisterAgentTools(null);
      }
    };
  }, [executeToolCall, getContext, onRegisterAgentTools]);

  // Propagate savingStatus changes
  useEffect(() => {
    const view = editorRef.current?.getEditorRef()?.getView();
    if (view) (window as any).__view = view;
    
    if (onSavingStatusChange) {
      onSavingStatusChange(savingStatus);
    }
  }, [savingStatus, onSavingStatusChange]);

  return (
    <div className="document-workspace-container">
      {/* Editor viewport */}
      <div className="document-editor-viewport">
        {loading ? (
          <div className="document-loading-overlay">
            <div className="loading-spinner" />
            <span>Loading Document Workspace...</span>
          </div>
        ) : error ? (
          <div className="document-loading-overlay" style={{ color: "#ff4d4d" }}>
            <span>Error: {error}</span>
          </div>
        ) : documentBuffer ? (
          <DocxEditorWrapper
            editorRef={editorRef}
            documentBuffer={documentBuffer}
            onChange={handleLocalChange}
            userProfile={userProfile}
            width={width}
            threadId={threadId}
          />
        ) : (
          <div className="document-loading-overlay">
            <Sparkles size={24} style={{ color: "var(--accent-light)", opacity: 0.6 }} />
            <span>No document active. Select a conversation to load.</span>
          </div>
        )}
      </div>
    </div>
  );
};
export default DocumentWorkspace;
