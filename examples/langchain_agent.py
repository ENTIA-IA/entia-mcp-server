"""ENTIA + LangChain agent example.

Requirements:
    pip install entia-mcp[langchain] langchain-openai

This creates an AI agent that can search and verify businesses using ENTIA.
"""

from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate

from entia_mcp.langchain import build_entia_tools

# 1. Build ENTIA tools
tools = build_entia_tools()
print(f"Loaded {len(tools)} ENTIA tools:")
for t in tools:
    print(f"  - {t.name}: {t.description[:60]}...")

# 2. Create agent
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a business intelligence assistant powered by ENTIA. "
        "Use entia_search to find companies, entia_profile for full dossiers, "
        "and entia_verify_vat to check EU VAT numbers. "
        "Always cite the trust score and data sources in your answers.",
    ),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm=llm, tools=tools, prompt=prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 3. Run queries
queries = [
    "Find the top 3 dental clinics in Barcelona and compare their trust scores",
    "Is VAT number ESA28015865 valid? Who does it belong to?",
    "Get the full profile for Inditex in Spain",
]

for q in queries:
    print(f"\n{'='*60}")
    print(f"Query: {q}")
    print("=" * 60)
    result = executor.invoke({"input": q})
    print(f"\nAnswer: {result['output']}")
