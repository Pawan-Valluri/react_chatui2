import y_py as Y

class YjsExtractor:
    """
    Parses a Yjs state vector and extracts ID-prefixed Markdown for LLM ingestion.
    """

    @staticmethod
    def extract_markdown(state_vector: bytes) -> str:
        """
        Loads the Yjs binary state into y-py and walks the XML/Map tree 
        to serialize it into plain Markdown without ProseMirror/docx metadata.
        Prepends [id] to block elements.
        """
        ydoc = Y.YDoc()
        Y.apply_update(ydoc, state_vector)
        
        prosemirror_root = ydoc.get_xml_element("prosemirror")
        return YjsExtractor._traverse_element(prosemirror_root)

    @staticmethod
    def _traverse_element(element) -> str:
        output = []
        if not hasattr(element, "__len__"):
            return ""

        for i in range(len(element)):
            child = element[i]
            
            if type(child) is Y.YXmlText:
                output.append(str(child))
            elif type(child) is Y.YXmlElement:
                tag = child.tag
                attrs = json.loads(child.get_attribute('id') or 'null')
                node_id = child.get_attribute('id') or 'no-id'

                if tag == "paragraph":
                    content = YjsExtractor._traverse_element(child)
                    output.append(f"[{node_id}] {content}\n")
                elif tag == "table":
                    output.append(f"[{node_id}]\n")
                    output.append(YjsExtractor._traverse_table(child))
                elif tag == "list":
                    # Simplify list representation
                    content = YjsExtractor._traverse_element(child)
                    output.append(f"[{node_id}] List:\n{content}\n")
                else:
                    # Generic inline or other blocks
                    output.append(YjsExtractor._traverse_element(child))

        return "".join(output)

    @staticmethod
    def _traverse_table(table_element: Y.YXmlElement) -> str:
        """Simple mock rendering of a table for markdown."""
        rows = []
        for i in range(len(table_element)):
            row_el = table_element[i]
            if type(row_el) is Y.YXmlElement and row_el.tag in ("table_row", "tr"):
                cells = []
                for j in range(len(row_el)):
                    cell_el = row_el[j]
                    if type(cell_el) is Y.YXmlElement:
                        cell_content = YjsExtractor._traverse_element(cell_el).strip()
                        cells.append(cell_content)
                rows.append("| " + " | ".join(cells) + " |")
        
        if not rows:
            return "| Empty Table |\n"
            
        header_sep = "|---" * len(cells) + "|"
        rows.insert(1, header_sep)
        return "\n".join(rows) + "\n"
