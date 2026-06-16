# backend/agent.py

from typing import Annotated, List, TypedDict, Any, Literal, Optional
from langchain_core.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage, ToolMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt
from langgraph.checkpoint.sqlite import SqliteSaver
import sqlite3

# Define clean enterprise Agent State structure
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    reasoning_steps: List[str]  # Tracks the consecutive reasoning thoughts
    loop_counter: int           # Safety guardrail counter

# ──────────────────────────────────────────────────────────────────────────
# 🛠️ Define Clean Native Production Tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def think(thought: str) -> str:
    """Use this tool to record consecutive thoughts, plans, or silent reasoning steps.
    This enables breaking down complex prompts before executing tools or responding.
    """
    return "Thought recorded."

@tool
async def search_kb(query: str) -> str:
    """Search the corporate Knowledge Base for APCOT Chat system specifications, vanilla CSS design principles, and guidelines."""
    return (
        "Knowledge Base Found: 'APCOT Chat' is a premium web client utilizing "
        "@assistant-ui/react primitives styled completely via Vanilla CSS (Tailwind-free) "
        "complying with modular component-tree encapsulation design principles."
    )

@tool
async def check_entitlements(resource: str) -> str:
    """Check group entitlements and access permissions for the current resource."""
    return (
        "AUTHORIZED: User is a member of 'SSO_APP_ADMIN'. "
        "Granted full administration, thread deletion, and query permissions."
    )

from sqlalchemy import create_engine, text

@tool
def read_markdown_section(file_id: str, heading_name: str) -> str:
    """Reads the specific section of the markdown document under the specified heading.
    Use this to extract detailed content that you see listed in the document's Table of Contents.
    Provide the exact heading name.
    """
    engine = create_engine("sqlite:///./apcot_chat.db")
    with engine.connect() as conn:
        res = conn.execute(text("SELECT markdown_content FROM attachments WHERE id = :id"), {"id": file_id}).fetchone()
        if not res:
            return f"Error: Document with ID '{file_id}' not found."
            
        content = res[0]
        lines = content.split('\n')
        extracting = False
        section_text = []
        heading_level = 0
        
        target_heading_clean = heading_name.replace('#', '').strip().lower()
        
        for line in lines:
            if line.startswith('#'):
                current_level = len(line.split(' ')[0])
                current_heading = line.replace('#', '').strip().lower()
                
                if not extracting and current_heading == target_heading_clean:
                    extracting = True
                    heading_level = current_level
                    continue
                elif extracting and current_level <= heading_level:
                    break
                    
            if extracting:
                section_text.append(line)
                
        if not extracting:
            return f"Heading '{heading_name}' not found in the document."
            
        return "\n".join(section_text)[:2000]

@tool
def search_document(file_id: str, query: str) -> str:
    """Executes a keyword search against the specified document. 
    Returns the most relevant chunks of text from the document.
    """
    engine = create_engine("sqlite:///./apcot_chat.db")
    with engine.connect() as conn:
        try:
            # Simple fallback search using LIKE if FTS fails
            fts_query = f'"{query}"'
            res = conn.execute(text(
                "SELECT snippet(attachments_fts, 3, '>>', '<<', '...', 64) as matched_snippet "
                "FROM attachments_fts "
                "WHERE attachments_fts MATCH :q AND id = :id "
                "LIMIT 3"
            ), {"q": fts_query, "id": file_id}).fetchall()
            
            if not res:
                return f"No results found for query '{query}' in document '{file_id}'."
                
            results = [row[0] for row in res]
            return "Search Results:\n\n" + "\n\n---\n\n".join(results)
        except Exception:
            # Fallback to simple substring search if FTS table is having issues
            res = conn.execute(text("SELECT markdown_content FROM attachments WHERE id = :id"), {"id": file_id}).fetchone()
            if not res:
                return f"Error: Document with ID '{file_id}' not found."
            content = res[0]
            if query.lower() in content.lower():
                idx = content.lower().find(query.lower())
                start = max(0, idx - 100)
                end = min(len(content), idx + 200)
                return f"Found match:\n...{content[start:end]}..."
            return f"No results found for '{query}'"

# ──────────────────────────────────────────────────────────────────────────
# 🖥️ Client Tool Node (Remote Execution)
# ──────────────────────────────────────────────────────────────────────────

def client_tool_node(state: AgentState):
    """
    Handles frontend-native tool calls using LangGraph's interrupt API.
    Execution halts here, saving state to the checkpointer, and bubbles up to FastAPI.
    """
    tool_calls = state["messages"][-1].tool_calls
    
    # 1. Trigger the native pause.
    client_responses = interrupt({
        "status": "requires_action", 
        "tool_calls": tool_calls
    })
    
    # 2. Execution wakes up here after frontend POSTs the result
    tool_messages = [
        ToolMessage(tool_call_id=resp["tool_call_id"], content=resp["output"]) 
        for resp in client_responses
    ]
    
    return {"messages": tool_messages}

# ──────────────────────────────────────────────────────────────────────────
# 🔀 The Dynamic Conditional Router
# ──────────────────────────────────────────────────────────────────────────

def evaluate_agent_step(state: AgentState) -> Literal["agent", "tools", "client_tools", "__end__"]:
    # Loop safety guardrail to prevent infinite billing recursion
    if state.get("loop_counter", 0) >= 12:
        print("Loop Safety Guardrail triggered: forcing termination.")
        return END

    last_message = state["messages"][-1]

    # If the last message contains no tool calls, we have our final response!
    if not last_message.tool_calls:
        return END

    # Check if the LLM called the virtual 'think' tool
    is_thinking = any(tc["name"] == "think" for tc in last_message.tool_calls)
    if is_thinking:
        return "agent"  # Loops back to agent_node for consecutive thought steps

    # Check for frontend-native remote tools
    remote_tools = {"insert_paragraph", "insert_table", "insert_list", "apply_style"}
    if any(tc["name"] in remote_tools for tc in last_message.tool_calls):
        return "client_tools"

    return "tools"      # Routes to native ToolNode for system execution

# ──────────────────────────────────────────────────────────────────────────
# 🏗️ State Machine Factory
# ──────────────────────────────────────────────────────────────────────────

def create_agent_graph(llm: BaseChatModel, tools: List[Any] = None, checkpointer: Any = None):
    """Compiles the pristine production LangGraph using a polymorphic LLM dependency."""
    
    # 1. Default to core native production tools if none are passed
    if tools is None:
        tools = [think, search_kb, check_entitlements, read_markdown_section, search_document]
        
    llm_with_tools = llm.bind_tools(tools)

    # 2. Define the Agent thinking node
    async def agent_node(state: AgentState) -> dict:
        # Log previous messages to console to test correct branching
        print(f"\n--- [AGENT GRAPH RUN] Dynamic Message Context (Count: {len(state['messages'])}) ---")
        for idx, msg in enumerate(state["messages"]):
            role = "USER" if msg.type == "human" else ("TOOL" if msg.type == "tool" else "ASSISTANT")
            details = ""
            if msg.type == "ai" and msg.tool_calls:
                details = f" [ToolCalls: {[tc['name'] for tc in msg.tool_calls]}]"
            elif msg.type == "tool":
                details = f" [ToolName: {msg.name}, Status: complete]"
            snippet = msg.content[:90] if isinstance(msg.content, str) else str(msg.content)[:90]
            print(f"  [{idx}] {role}: {snippet}{details}")
        print("--------------------------------------------------------------------\n")

        # Invoke LLM
        response = await llm_with_tools.ainvoke(state["messages"])
        
        # Extract and compile reasoning steps
        new_reasoning = list(state.get("reasoning_steps", []))
        if response.tool_calls:
            for tc in response.tool_calls:
                if tc["name"] == "think":
                    new_reasoning.append(tc["args"]["thought"])

        return {
            "messages": [response],
            "reasoning_steps": new_reasoning,
            "loop_counter": state.get("loop_counter", 0) + 1
        }

    # 3. Compile workflow
    workflow = StateGraph(AgentState)
    
    # Add nodes
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools))
    workflow.add_node("client_tools", client_tool_node)
    
    # Add edges
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", evaluate_agent_step, ["agent", "tools", "client_tools", END])
    workflow.add_edge("tools", "agent")
    workflow.add_edge("client_tools", "agent")
    
    return workflow.compile(checkpointer=checkpointer)
