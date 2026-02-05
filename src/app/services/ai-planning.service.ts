// Author: Preston Lee

import { Injectable } from '@angular/core';

/**
 * Tools allowed in Plan Mode (read-only investigation)
 */
const PLAN_MODE_ALLOWED_TOOLS = new Set([
  'get_code',
  'list_libraries',
  'get_library_content',
  'search_code',
  'read_file',
  'list_files',
  'get_cursor_position',
  'get_selection',
  'web_search',
  'searxng_search',
  'fetch_url'
]);

/**
 * Tools blocked in Plan Mode (modification tools)
 */
const PLAN_MODE_BLOCKED_TOOLS = new Set([
  'insert_code',
  'replace_code',
  'delete_file',
  'write_file',
  'edit_file',
  'create_library'
]);

@Injectable({
  providedIn: 'root'
})
export class AiPlanningService {
  
  /**
   * Check if a tool is allowed in Plan Mode
   */
  isToolAllowedInPlanMode(toolName: string): boolean {
    return PLAN_MODE_ALLOWED_TOOLS.has(toolName);
  }
  
  /**
   * Check if a tool is blocked in Plan Mode
   */
  isToolBlockedInPlanMode(toolName: string): boolean {
    return PLAN_MODE_BLOCKED_TOOLS.has(toolName);
  }
  
  /**
   * Validate tool call for current mode
   */
  validateToolCallForMode(toolName: string, mode: 'plan' | 'act'): { allowed: boolean; reason?: string } {
    if (mode === 'plan') {
      if (this.isToolBlockedInPlanMode(toolName)) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' is not allowed in Plan Mode. Plan Mode only allows read-only investigation tools.`
        };
      }
    }
    // Act Mode allows all tools
    return { allowed: true };
  }
  
  /**
   * Get Plan Mode system prompt additions
   */
  getPlanModeSystemPrompt(): string {
    return `
## 🚨 YOU ARE IN PLAN MODE 🚨

**CRITICAL RESTRICTIONS:**
- You MUST NOT modify any files
- You MUST NOT call tools that modify code: insert_code, replace_code, delete_file, write_file, edit_file, create_library
- You CAN ONLY use investigation tools: get_code, list_libraries, get_library_content, search_code, read_file, list_files, web_search, searxng_search, fetch_url

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
   * Get Act Mode system prompt additions (can reference plan if available)
   */
  getActModeSystemPrompt(hasPlan: boolean = false): string {
    let prompt = `
## 🚀 YOU ARE IN ACT MODE 🚀

**YOUR ROLE:**
- Execute the implementation based on the plan (if available)
- Use tools to modify code as needed
- Make actual changes to the codebase
- Follow through on the agreed strategy
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
`;
    }
    
    prompt += `
**TOOLS AVAILABLE:**
- All tools are available, including code modification tools
- Use insert_code, replace_code, create_library as needed
- Read files first to understand context before modifying
`;
    
    return prompt;
  }
}

