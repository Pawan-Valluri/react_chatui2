from typing import Annotated, List, TypedDict, Any
import asyncio
from langgraph.graph import StateGraph, START, END

# Define agent state structure
class AgentState(TypedDict):
    input_text: str
    reasoning_steps: List[str]
    tool_calls: List[dict]
    response_text: str
    current_node: str

# Define nodes for the LangGraph state machine
async def thinking_node(state: AgentState) -> dict:
    # Simulate thinking delay
    await asyncio.sleep(0.1)
    reasoning = [
        "Analyzing prompt and checking workspace requirements...",
        "Identifying UI guidelines in 'ui-project-bootstrap-guidelines.md'...",
        "Synthesizing response for APCOT Chat interface..."
    ]
    return {
        "reasoning_steps": reasoning,
        "current_node": "thinking"
    }

async def tool_node(state: AgentState) -> dict:
    input_lower = state["input_text"].lower()
    tool_calls = []
    
    # Check if prompt triggers our dummy search tool
    if any(keyword in input_lower for keyword in ["search", "kb", "knowledge", "help", "guide", "info", "apcot"]):
        await asyncio.sleep(0.1)
        # Add a simulated tool call
        tool_calls.append({
            "toolCallId": "tc_kb_search_1",
            "toolName": "search_kb",
            "args": {"query": state["input_text"]},
            "status": "running"
        })
        # Simulate tool execution delay
        await asyncio.sleep(0.2)
        tool_calls[0]["status"] = "complete"
        tool_calls[0]["result"] = (
            "Knowledge Base Found: 'APCOT Chat' is a premium web client utilizing "
            "@assistant-ui/react primitives styled completely via Vanilla CSS (Tailwind-free) "
            "complying with modular component-tree encapsulation design principles."
        )
    
    return {
        "tool_calls": tool_calls,
        "current_node": "tool"
    }

async def generation_node(state: AgentState) -> dict:
    input_text = state["input_text"]
    input_lower = input_text.lower()
    
    # Select appropriate response text
    if any(keyword in input_lower for keyword in ["search", "kb", "knowledge", "help", "guide", "info", "apcot"]):
        response = (
            "Hello! I ran a search in our Knowledge Base concerning **APCOT Chat**. "
            "Based on the results, the system has successfully booted in a standard "
            "Vite, React, and TypeScript environment. The layout uses pure Vanilla CSS "
            "with a customizable sidebar, active reasoning UI, and tool usage visualization. "
            "Everything is fully modular and ready for external integration! How would you like "
            "to proceed with the implementation?"
        )
    elif "hello" in input_lower or "hi" in input_lower:
        response = (
            "Hello there! I am **APCOT Chat**, your dynamic AI assistant built with `@assistant-ui/react` "
            "and Vanilla CSS. I can answer your questions, demonstrate tool usage, and show you "
            "my step-by-step thinking reasoning traces. What can I do for you today?"
        )
    else:
        response = (
            f"Thank you for your message: \"{input_text}\". I have processed your input through my "
            "LangGraph state machine! You can see my thought traces (reasoning) and tool execution cards "
            "above. If you ask me to 'search the knowledge base', I can execute a simulated database tool "
            "for you. Let me know how I can help!"
        )
        
    return {
        "response_text": response,
        "current_node": "generation"
    }

# Build LangGraph workflow
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("thinking", thinking_node)
workflow.add_node("tool", tool_node)
workflow.add_node("generation", generation_node)

# Set up edges
workflow.add_edge(START, "thinking")
workflow.add_edge("thinking", "tool")
workflow.add_edge("tool", "generation")
workflow.add_edge("generation", END)

# Compile graph
agent_graph = workflow.compile()
