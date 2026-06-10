# backend/mock_showcase/mock_routes.py

# Static conversation pathways registry for developer showcase mode
CONVERSATION_ROUTES = {
    "multi_step": {
        "thoughts_phase_1": [
            "Initializing advanced multi-step search pipeline...",
            "Searching the primary Knowledge Base for 'APCOT Chat' baseline architecture...",
            "Retrieving local framework specifications for @assistant-ui/react..."
        ],
        "tool_call_1": {
            "name": "search_kb",
            "args": {"query": "APCOT Chat framework architecture"},
            "result": (
                "SUCCESS: Found Knowledge Base specs for 'APCOT Chat'. "
                "Core: React, Vite, TypeScript. UI primitives: @assistant-ui/react. "
                "Styling: Pure Vanilla CSS with smooth collapsing transitions."
            )
        },
        "thoughts_phase_2": [
            "Baseline specifications retrieved successfully.",
            "Now querying corporate Entitlements Repository to check group policy constraints...",
            "Verifying active SSO permissions for the current user..."
        ],
        "tool_call_2": {
            "name": "check_entitlements",
            "args": {"resource": "APCOT Chat"},
            "result_template": (
                "AUTHORIZED: User '{user_id}' is a member of 'SSO_APP_ADMIN'. "
                "Granted full administration, thread deletion, and query permissions."
            )
        },
        "thoughts_phase_3": [
            "Group membership and SSO permissions verified.",
            "Formulating final consolidated response including architectural specs and entitlement access status..."
        ],
        "response_template": (
            "Hello {fullname}! I have executed an advanced multi-step "
            "reasoning trace and triggered two local tools on your behalf:\n\n"
            "1. **`search_kb`**: Retrieved the system design documents confirming APCOT Chat's "
            "vanilla CSS layout and assistant primitives.\n"
            "2. **`check_entitlements`**: Verified that your ADs ID (**`{user_id}`**) "
            "is registered with **`SSO_APP_ADMIN`** corporate groups, granting you full administrative "
            "permissions over this workspace.\n\n"
            "The system is fully operational and securely integrated with your AuthBlue profile. "
            "Let me know what you'd like to build next!"
        )
    },
    
    "search": {
        "thoughts": [
            "Analyzing prompt and checking workspace requirements...",
            "Identifying UI guidelines in 'ui-project-bootstrap-guidelines.md'...",
            "Synthesizing response for APCOT Chat interface..."
        ],
        "tool_call": {
            "name": "search_kb",
            "result": (
                "Knowledge Base Found: 'APCOT Chat' is a premium web client utilizing "
                "@assistant-ui/react primitives styled completely via Vanilla CSS (Tailwind-free) "
                "complying with modular component-tree encapsulation design principles."
            )
        },
        "response": (
            "Hello! I ran a search in our Knowledge Base concerning **APCOT Chat**. "
            "Based on the results, the system has successfully booted in a standard "
            "Vite, React, and TypeScript environment. The layout uses pure Vanilla CSS "
            "with a customizable sidebar, active reasoning UI, and tool usage visualization. "
            "Everything is fully modular and ready for external integration! How would you like "
            "to proceed with the implementation?"
        )
    },
    
    "greeting": {
        "thoughts": [
            "Analyzing greetings and initializing communication channel..."
        ],
        "response": (
            "Hello there! I am **APCOT Chat**, your dynamic AI assistant built with `@assistant-ui/react` "
            "and Vanilla CSS. I can answer your questions, demonstrate tool usage, and show you "
            "my step-by-step thinking reasoning traces. What can I do for you today?"
        )
    },
    
    "edit_document": {
        "thoughts": [
            "Analyzing user request to modify workspace document...",
            "Querying the active document state to identify paragraphs and paraId handles..."
        ],
        "tool_call_1": {
            "name": "read_document",
            "args": {}
        },
        "thoughts_phase_2": [
            "Active document state retrieved successfully.",
            "Analyzing paragraph anchors to locate targets...",
            "Formulating proposed tracked change suggestion for the second paragraph..."
        ],
        "tool_call_2": {
            "name": "suggest_change",
            "args": {
                "paraId": "placeholder_id",
                "search": "Welcome to your APCOT Chat Workspace Document.",
                "replaceWith": "Welcome to your premium APCOT Chat Document Workspace."
            }
        },
        "thoughts_phase_3": [
            "Tracked change suggestion dispatched.",
            "Attaching an explanatory review comment to the same paragraph..."
        ],
        "tool_call_3": {
            "name": "add_comment",
            "args": {
                "paraId": "placeholder_id",
                "text": "Suggesting a warmer, premium header styling.",
                "search": "Welcome"
            }
        },
        "thoughts_phase_4": [
            "Comment successfully anchored.",
            "Converting the next paragraph into a bullet list item to enhance scannability..."
        ],
        "tool_call_4": {
            "name": "toggle_bullet_list",
            "args": {
                "paraId": "placeholder_id_2",
                "enabled": True
            }
        },
        "thoughts_phase_5": [
            "Bullet list style applied in the editor.",
            "Appending a final sign-off paragraph at the bottom of the document..."
        ],
        "tool_call_5": {
            "name": "append_paragraph",
            "args": {
                "text": "This paragraph was dynamically appended by the mock LLM!",
                "styleId": "Normal"
            }
        },
        "thoughts_phase_6": [
            "Paragraph successfully appended.",
            "Formulating final response to summarize edits..."
        ],
        "response": (
            "I have performed a multi-step document review and edit sequence:\n\n"
            "1. **`read_document`**: Inspected the document hierarchy.\n"
            "2. **`suggest_change`**: Suggested a tracked revision changing 'Welcome...' to 'Welcome to your premium...'.\n"
            "3. **`add_comment`**: Added a comment explaining the edit.\n"
            "4. **`toggle_bullet_list`**: Converted the next paragraph into a bullet point list item.\n"
            "5. **`append_paragraph`**: Appended a new paragraph at the bottom of the document.\n\n"
            "All edits have been applied directly to your active browser editor and saved to the backend Single Source of Truth!"
        )
    },
    
    "add_table": {
        "thoughts": [
            "Analyzing user request to insert a structured data grid...",
            "Reading document structure to locate target paraId..."
        ],
        "tool_call_1": {
            "name": "read_document",
            "args": {}
        },
        "thoughts_phase_2": [
            "Document paragraphs retrieved.",
            "Compiling a deeply customized cells matrix containing bold headers, custom colors, shading, and bullet points...",
            "Inserting the new table after the first paragraph..."
        ],
        "tool_call_2": {
            "name": "insert_table",
            "args": {
                "paraId": "placeholder_id",
                "rows": 3,
                "cols": 3,
                "styleId": "HeadingTable",
                "cells": [
                    [
                        {"content": [{"type": "paragraph", "text": "Feature", "marks": {"bold": True}}]},
                        {"content": [{"type": "paragraph", "text": "Status", "marks": {"bold": True}}]},
                        {"content": [{"type": "paragraph", "text": "Details", "marks": {"bold": True}}]}
                    ],
                    [
                        {"content": [{"type": "paragraph", "text": "SSO Login"}]},
                        {"content": [{"type": "paragraph", "text": "Complete", "marks": {}}, {"type": "bullet_list", "items": ["AuthBlue SSO", "HttpOnly Signed JWT Token"]}]},
                        {"content": [{"type": "paragraph", "text": "Fully integrated into login shell"}]}
                    ],
                    [
                        {"content": [{"type": "paragraph", "text": "Table Formatting"}]},
                        {"content": [{"type": "paragraph", "text": "Pristine", "marks": {}}]},
                        {"content": [{"type": "bullet_list", "items": ["Deeply configurable cells", "Custom shading fills", "Multi-elements cell layout"]}]}
                    ]
                ]
            }
        },
        "thoughts_phase_3": [
            "Table successfully created in editor.",
            "Let's add a row at the bottom of the table..."
        ],
        "tool_call_3": {
            "name": "add_table_row",
            "args": {
                "paraId": "placeholder_id",
                "position": "after"
            }
        },
        "thoughts_phase_4": [
            "New row inserted.",
            "Formulating final response to summarize table addition..."
        ],
        "response": (
            "I have updated your document workspace by generating and inserting a deeply configurable status table:\n\n"
            "- **`insert_table`**: Created a 3x3 grid containing custom cell shading colors (light blue/yellow), "
            "bold/italic text formatting, and nested bullet points inside table cells.\n"
            "- **`add_table_row`**: Dynamically added an empty fourth row at the bottom of the table.\n\n"
            "Check out the rendered result in the Workspace Panel on the right!"
        )
    },
    
    "default": {
        "thoughts": [
            "Analyzing input and matching with graph handlers..."
        ],
        "response_template": (
            "Thank you for your message: \"{input_text}\". I have processed your input through my "
            "LangGraph state machine! You can see my thought traces (reasoning) and tool execution cards "
            "above. Try asking me to 'edit document' to see bullet points and comments, or 'add table' to see deeply customizable cell shading, multi-element cells, and bullet points in table cells!"
        )
    }
}
