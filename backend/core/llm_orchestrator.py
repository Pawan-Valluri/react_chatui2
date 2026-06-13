import json

class LLMOrchestrator:
    """
    Manages interactions with the LLM, feeding it Markdown context 
    and yielding structured edit tool calls.
    """

    # The Symmetrical Tool Schemas
    # These exact signatures must be matched by the frontend EditorBridge.ts
    TOOLS_SCHEMA = [
        {
            "type": "function",
            "function": {
                "name": "insert_paragraph",
                "description": "Inserts a new paragraph relative to a target element.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string", "description": "The unique id of the reference element."},
                        "position": {"type": "string", "enum": ["before", "after"], "description": "Where to insert relative to the target."},
                        "text": {"type": "string", "description": "The text content of the new paragraph."},
                        "styleId": {"type": "string", "description": "The style ID to apply (e.g., 'Heading1', 'Normal')."}
                    },
                    "required": ["targetId", "position", "text", "styleId"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "insert_table",
                "description": "Inserts a new table relative to a target element.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string", "description": "The unique id of the reference element."},
                        "position": {"type": "string", "enum": ["before", "after"]},
                        "rows": {"type": "integer", "description": "Number of rows."},
                        "cols": {"type": "integer", "description": "Number of columns."},
                        "styleId": {"type": "string", "description": "The table style ID (e.g., 'TableGrid', 'HeadingTable')."}
                    },
                    "required": ["targetId", "position", "rows", "cols", "styleId"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "insert_list",
                "description": "Inserts a bulleted or numbered list.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string"},
                        "position": {"type": "string", "enum": ["before", "after"]},
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Array of list item strings."
                        },
                        "listStyleId": {"type": "string", "description": "The list style ID (e.g., 'ListParagraph', 'NumberedList')."}
                    },
                    "required": ["targetId", "position", "items", "listStyleId"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "apply_style",
                "description": "Changes the style of an existing block element.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string", "description": "The unique id of the target element."},
                        "styleId": {"type": "string", "description": "The new style ID to apply."}
                    },
                    "required": ["targetId", "styleId"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "suggest_change",
                "description": "Performs a localized text replacement within a specific paragraph.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string", "description": "The unique id of the target element."},
                        "searchString": {"type": "string", "description": "The exact string to find inside the element."},
                        "replaceString": {"type": "string", "description": "The text to replace it with."}
                    },
                    "required": ["targetId", "searchString", "replaceString"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "add_comment",
                "description": "Adds a comment annotation to an element.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string"},
                        "text": {"type": "string", "description": "The comment body."}
                    },
                    "required": ["targetId", "text"]
                }
            }
        }
    ]

    @staticmethod
    async def generate_edits(markdown_context: str, user_prompt: str, styles_context: str):
        """
        Accepts the Markdown extraction, the user prompt, and the associated styles context.
        Yields JSON chunks (SSE) representing LLM tool calls.
        """
        system_prompt = f"""
        You are a collaborative document editing agent.
        You must only use the tools provided to modify the document.
        Here are the valid styles available to you:
        {styles_context}
        
        The current document state (with target IDs):
        {markdown_context}
        """
        
        # TODO: Implement actual LLM API call using litellm or openai client
        # In a real execution, we would stream the tool calls.
        # For mock/testing purposes, we'll yield a dummy chunk matching our schema.
        pass
