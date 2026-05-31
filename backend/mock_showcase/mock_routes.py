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
    
    "default": {
        "thoughts": [
            "Analyzing input and matching with graph handlers..."
        ],
        "response_template": (
            "Thank you for your message: \"{input_text}\". I have processed your input through my "
            "LangGraph state machine! You can see my thought traces (reasoning) and tool execution cards "
            "above. If you ask me to 'search the knowledge base', I can execute a simulated database tool "
            "for you. Let me know how I can help!"
        )
    }
}
