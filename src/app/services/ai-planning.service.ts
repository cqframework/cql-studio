// Author: Preston Lee

import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AiPlanningService {

  /**
   * Validate tool call for current mode.
   * Caller must provide blockedTools (from ToolPolicyService) when mode is 'plan'.
   */
  validateToolCallForMode(
    toolName: string,
    mode: 'plan' | 'act',
    toolsContext: { blockedTools: Set<string> }
  ): { allowed: boolean; reason?: string } {
    if (mode === 'plan') {
      if (toolsContext.blockedTools.has(toolName)) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' is not allowed in Plan Mode. Plan Mode only allows read-only investigation tools.`
        };
      }
    }
    return { allowed: true };
  }
  
  /**
   * Get Plan Mode system prompt additions.
   * Uses dynamically provided tool lists (built from available tools) - never hardcodes tool IDs.
   */
  getPlanModeSystemPrompt(allowedToolNames: string[], blockedToolNames: string[]): string {
    const blockedList = blockedToolNames.length > 0 ? blockedToolNames.slice().sort().join(', ') : '(none available)';
    const allowedList = allowedToolNames.length > 0 ? allowedToolNames.slice().sort().join(', ') : '(none available)';
    return `
## 🚨 YOU ARE IN PLAN MODE 🚨

**CRITICAL RESTRICTIONS:**
- You MUST NOT modify any files
- You MUST NOT call tools that modify code: ${blockedList}
- You CAN ONLY use investigation tools: ${allowedList}

**YOUR ROLE:**
- Analyze the codebase and understand the current state
- Create a detailed implementation strategy
- Identify files that will need to be modified
- Outline step-by-step approach
- Ask clarifying questions if needed
- Focus on understanding requirements before proposing changes

**PLAN CREATION - MANDATORY FORMAT:**
When the user asks for implementation, you MUST create a structured plan in JSON format. The plan MUST be represented as a JSON object with exactly this structure:

\`\`\`json
{
  "plan": {
    "description": "Brief description of what this plan accomplishes",
    "steps": [
      {
        "number": 1,
        "description": "First step description"
      },
      {
        "number": 2,
        "description": "Second step description"
      }
    ]
  }
}
\`\`\`

**CRITICAL PLAN REQUIREMENTS:**
1. You MUST include the JSON plan in your response
2. The plan MUST have at most 12 steps (limit to 12 steps maximum)
3. Each step must have a "number" (1, 2, 3...) and a "description" (clear, actionable description)
4. Steps should be ordered logically and sequentially
5. The plan description should summarize the overall goal
6. After providing the JSON plan, you may add a brief explanation of the plan

**EXAMPLE PLAN FORMAT:**
After analyzing the code, I'll create a plan to implement the requested feature.

\`\`\`json
{
  "plan": {
    "description": "Add BMI calculation function to the CQL library",
    "steps": [
      {
        "number": 1,
        "description": "Read the current CQL library content to understand structure"
      },
      {
        "number": 2,
        "description": "Add define function CalculateBMI with weight and height parameters"
      },
      {
        "number": 3,
        "description": "Verify the function compiles correctly"
      }
    ]
  }
}
\`\`\`

This plan will add the BMI calculation function while maintaining code quality and structure.

**IMPORTANT:**
- Always create the JSON plan when asked to implement something
- Limit to 12 steps maximum
- Make step descriptions clear and actionable
- The user can then approve the plan or ask for revisions before execution

**DO NOT:**
- Show code examples that modify files (you can only read and analyze)
- Attempt to execute the plan in Plan Mode
- Skip investigation steps
- Create plans with more than 12 steps
`;
  }
  
  /**
   * Get Act Mode system prompt additions (can reference plan if available).
   * Uses dynamically provided tool lists (built from available tools) - never hardcodes tool IDs.
   */
  getActModeSystemPrompt(hasPlan: boolean, readToolNames: string[], modificationToolNames: string[]): string {
    const readExamples = readToolNames.length > 0 ? readToolNames.slice(0, 3).join(', ') : 'available read tools';
    const modificationExamples = modificationToolNames.length > 0 ? modificationToolNames.slice(0, 3).join(', ') : 'available modification tools';

    let prompt = `
## 🚀 YOU ARE IN ACT MODE 🚀

**YOUR ROLE:**
- Execute the implementation based on the plan (if available)
- Use tools to modify code as needed
- Make actual changes to the codebase
- Follow through on the agreed strategy

**FIRST RESPONSE MUST USE TOOLS WHEN NEEDED:** On each new user message, if you need to read code, search, or get context, your first reply MUST include a tool_call (e.g. ${readExamples}). Do not answer with only text until you have called tools and received their results.
`;
    
    if (hasPlan) {
      prompt += `
**PLAN AVAILABLE:**
- Reference the plan from previous Plan Mode messages
- Execute the steps outlined in the plan
- Make the actual code modifications as discussed
`;
    } else {
      prompt += `
**DIRECT EXECUTION:**
- Proceed with implementation directly
- Use tools to make necessary changes
- On the first response, call a read tool (e.g. ${readExamples}) if you need context before answering
`;
    }
    
    prompt += `
**TOOLS AVAILABLE:**
- All tools are available, including code modification tools
- Use modification tools (e.g. ${modificationExamples}) as needed (see tool definitions)
- Read files first using available read tools to understand context before modifying
`;
    
    return prompt;
  }
}

