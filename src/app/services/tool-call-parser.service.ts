// Author: Preston Lee

import { Injectable } from '@angular/core';

export interface ParsedToolCall {
  tool: string;
  params: Record<string, any>;
  raw: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToolCallParserService {
  /**
   * Parse tool calls from AI response text
   * Supports multiple formats:
   * 1. JSON blocks: {"tool": "name", "params": {...}}
   * 2. Markdown code blocks with tool metadata
   * 3. MCP-native format
   */
  parseToolCalls(responseText: string): ParsedToolCall[] {
    const toolCalls: ParsedToolCall[] = [];

    if (!responseText || responseText.trim().length === 0) {
      return toolCalls;
    }

    // Try JSON block format: {"tool": "name", "params": {...}}
    // This approach finds the start of a tool call object and then properly balances braces
    // to handle nested JSON structures (like code in params with newlines and braces)
    const toolCallStarts: number[] = [];
    
    // Find all potential tool call starts: {"tool"
    const toolPattern = /\{\s*"tool"\s*:/g;
    let match;
    while ((match = toolPattern.exec(responseText)) !== null) {
      toolCallStarts.push(match.index);
    }

    // For each potential start, try to parse the complete JSON object
    for (const startPos of toolCallStarts) {
      try {
        const jsonObject = this.extractJsonObject(responseText, startPos);
        if (jsonObject) {
          let parsed: any;
          try {
            // First try parsing as-is
            parsed = JSON.parse(jsonObject);
          } catch (parseError: any) {
            // If parsing fails, try to repair malformed JSON (e.g., literal newlines in strings)
            const repaired = this.repairJsonWithNewlines(jsonObject);
            if (repaired) {
              try {
                parsed = JSON.parse(repaired);
                console.log('[Tool Parser] ✅ Repaired and parsed tool call JSON');
              } catch (repairError: any) {
                console.warn('[Tool Parser] ❌ Failed to parse even after repair:', repairError.message);
                throw parseError; // Throw original error
              }
            } else {
              throw parseError;
            }
          }
          
        if (parsed.tool && parsed.params) {
          toolCalls.push({
            tool: parsed.tool,
            params: parsed.params,
            raw: jsonObject
          });
          console.log('[Tool Parser] ✅ Parsed tool call:', parsed.tool, 'params keys:', Object.keys(parsed.params));
          
          // Special logging for code editing tools with multiline content
          if ((parsed.tool === 'insert_code' || parsed.tool === 'replace_code') && parsed.params['code']) {
            const code = parsed.params['code'];
            const hasNewlines = code.includes('\n') || code.split('\n').length > 1;
            console.log(`[Tool Parser] Code parameter length: ${code.length}, has newlines: ${hasNewlines}, lines: ${code.split('\n').length}`);
            if (hasNewlines) {
              console.log('[Tool Parser] First 100 chars of code:', code.substring(0, 100).replace(/\n/g, '\\n'));
            }
          }
        } else {
          console.warn('[Tool Parser] ⚠️ Invalid tool call structure at position', startPos, 'missing tool or params:', parsed);
        }
        } else {
          console.debug('[Tool Parser] Could not extract complete JSON object at position', startPos);
        }
      } catch (e: any) {
        // Log parsing errors with more detail
        const snippet = responseText.substring(startPos, Math.min(startPos + 200, responseText.length));
        console.warn('[Tool Parser] ❌ Failed to parse potential tool call at position', startPos, 'error:', e.message);
        console.warn('[Tool Parser] Snippet:', snippet.substring(0, 100) + '...');
      }
    }
    
    if (toolCallStarts.length > 0 && toolCalls.length === 0) {
      console.warn('[Tool Parser] ⚠️ Found', toolCallStarts.length, 'potential tool call starts but parsed 0 calls');
      console.warn('[Tool Parser] Response preview:', responseText.substring(0, 500));
    }

    // Try markdown code block format with tool metadata
    // ```tool:tool_name
    // {"param1": "value1"}
    // ```
    const markdownToolRegex = /```[\s]*tool:(\w+)[\s]*\n([\s\S]*?)```/g;
    while ((match = markdownToolRegex.exec(responseText)) !== null) {
      try {
        let params: any;
        const paramsJson = match[2].trim();
        try {
          params = JSON.parse(paramsJson);
        } catch (parseError: any) {
          // Try to repair if parsing fails
          const repaired = this.repairJsonWithNewlines(paramsJson);
          if (repaired) {
            try {
              params = JSON.parse(repaired);
              console.log('[Tool Parser] ✅ Repaired and parsed markdown tool call JSON');
            } catch (repairError) {
              console.warn('Failed to parse markdown tool call even after repair:', match[0]);
              continue;
            }
          } else {
            console.warn('Failed to parse markdown tool call:', match[0]);
            continue;
          }
        }
        toolCalls.push({
          tool: match[1],
          params,
          raw: match[0]
        });
      } catch (e) {
        console.warn('Failed to parse markdown tool call:', match[0]);
      }
    }

    // Try MCP-native format: <tool_call tool="name" params='{...}' />
    const mcpNativeRegex = /<tool_call[\s]+tool=["'](\w+)["'][\s]+params=["'](\{[\s\S]*?\})["'][\s]*\/>/g;
    while ((match = mcpNativeRegex.exec(responseText)) !== null) {
      try {
        let params: any;
        const paramsJson = match[2];
        try {
          params = JSON.parse(paramsJson);
        } catch (parseError: any) {
          // Try to repair if parsing fails
          const repaired = this.repairJsonWithNewlines(paramsJson);
          if (repaired) {
            try {
              params = JSON.parse(repaired);
              console.log('[Tool Parser] ✅ Repaired and parsed MCP native tool call JSON');
            } catch (repairError) {
              console.warn('Failed to parse MCP native tool call even after repair:', match[0]);
              continue;
            }
          } else {
            console.warn('Failed to parse MCP native tool call:', match[0]);
            continue;
          }
        }
        toolCalls.push({
          tool: match[1],
          params,
          raw: match[0]
        });
      } catch (e) {
        console.warn('Failed to parse MCP native tool call:', match[0]);
      }
    }

    // Remove duplicates (same tool + same params)
    const unique = new Map<string, ParsedToolCall>();
    toolCalls.forEach(call => {
      const key = `${call.tool}:${JSON.stringify(call.params)}`;
      if (!unique.has(key)) {
        unique.set(key, call);
      }
    });

    return Array.from(unique.values());
  }

  /**
   * Check if response text contains tool calls (complete only)
   */
  hasToolCalls(responseText: string): boolean {
    return this.parseToolCalls(responseText).length > 0;
  }

  /**
   * Remove parsed tool call JSON from response text for display
   */
  removeToolCallJsonFromResponse(response: string, toolCalls: ParsedToolCall[]): string {
    let cleaned = response;
    for (const toolCall of toolCalls) {
      if (toolCall.raw && cleaned.includes(toolCall.raw)) {
        cleaned = cleaned.replace(toolCall.raw, '').trim();
      }
    }
    const standaloneToolCallPattern = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    cleaned = cleaned.replace(standaloneToolCallPattern, '').trim();
    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.includes('"tool"') && trimmed.includes('"params"')) {
        return false;
      }
      return true;
    });
    return filteredLines.join('\n').trim();
  }

  /**
   * Check if response text likely contains complete tool calls
   * This checks for complete JSON structures, not partial ones
   */
  hasCompleteToolCalls(responseText: string): boolean {
    // Only check for complete JSON structures - look for balanced braces
    const toolPattern = /\{\s*"tool"\s*:/g;
    let match;
    while ((match = toolPattern.exec(responseText)) !== null) {
      const jsonObject = this.extractJsonObject(responseText, match.index);
      if (jsonObject) {
        // Try to parse to validate it's complete
        try {
          const parsed = JSON.parse(jsonObject);
          if (parsed.tool && parsed.params) {
            return true; // Found at least one complete tool call
          }
        } catch {
          // Not complete, continue
        }
      }
    }
    return false;
  }

  /**
   * Detect if there's a potential tool call being written (for UI feedback only)
   * This is for streaming indicators - does NOT parse or execute
   */
  detectPartialToolCall(responseText: string): { tool: string; isComplete: boolean } | null {
    // Look for tool call pattern start
    const toolPattern = /\{\s*"tool"\s*:\s*"([^"]+)"/;
    const match = responseText.match(toolPattern);
    
    if (match) {
      // Check if we have a complete JSON object (rough check)
      const toolName = match[1];
      const startPos = match.index!;
      
      // Try to find if we have a complete object
      const potentialObject = this.extractJsonObject(responseText, startPos);
      const isComplete = potentialObject !== null;
      
      return {
        tool: toolName,
        isComplete
      };
    }

    return null;
  }

  /**
   * Parse tool calls only from complete, validated JSON
   * This is the main method - only parses complete tool calls
   */
  parseCompleteToolCalls(responseText: string): ParsedToolCall[] {
    // Only parse if we're not in the middle of streaming a JSON object
    // Check for balanced braces to ensure we have complete JSON
    return this.parseToolCalls(responseText);
  }

  /**
   * Find all tool-related JSON blocks (tool calls and tool results) in text
   * Returns an array of { start, end } positions for each block to remove
   */
  findToolJsonBlocks(text: string): Array<{ start: number; end: number; content: string }> {
    const blocks: Array<{ start: number; end: number; content: string }> = [];
    
    // Find all potential tool-related JSON blocks by looking for {"tool"
    const toolPattern = /\{\s*"tool"\s*:/g;
    let match;
    while ((match = toolPattern.exec(text)) !== null) {
      const jsonObject = this.extractJsonObject(text, match.index);
      if (jsonObject) {
        // Check if it's tool-related (has tool + params/success/result)
        try {
          const parsed = JSON.parse(jsonObject);
          if (parsed.tool && (parsed.params !== undefined || parsed.success !== undefined || parsed.result !== undefined)) {
            blocks.push({
              start: match.index,
              end: match.index + jsonObject.length,
              content: jsonObject
            });
          }
        } catch {
          // Not valid JSON, but still looks like a tool block - include it
          if (jsonObject.includes('"tool"') && 
              (jsonObject.includes('"params"') || jsonObject.includes('"success"') || jsonObject.includes('"result"'))) {
            blocks.push({
              start: match.index,
              end: match.index + jsonObject.length,
              content: jsonObject
            });
          }
        }
      }
    }
    
    return blocks;
  }

  /**
   * Extract a complete JSON object starting at the given position
   * Properly handles nested braces, escaped characters, and strings
   */
  private extractJsonObject(text: string, startPos: number): string | null {
    if (startPos >= text.length) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let i = startPos;
    
    // Skip to the opening brace
    while (i < text.length && text[i] !== '{') {
      i++;
    }
    
    if (i >= text.length) {
      return null;
    }

    const startIndex = i;
    depth = 1;
    i++; // Move past the opening brace

    while (i < text.length && depth > 0) {
      const char = text[i];
      
      if (escapeNext) {
        escapeNext = false;
        i++;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        i++;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        i++;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
        }
      }
      
      i++;
    }

    if (depth === 0) {
      // Found complete object
      return text.substring(startIndex, i);
    }

    // Incomplete object
    return null;
  }

  /**
   * Repair JSON string that contains literal newlines in string values
   * This handles cases where the LLM outputs unescaped newlines in JSON strings
   */
  private repairJsonWithNewlines(jsonString: string): string | null {
    try {
      let result = '';
      let inString = false;
      let escapeNext = false;
      let i = 0;
      
      while (i < jsonString.length) {
        const char = jsonString[i];
        
        if (escapeNext) {
          // Already escaped, keep as-is
          result += char;
          escapeNext = false;
          i++;
          continue;
        }
        
        if (char === '\\') {
          result += char;
          escapeNext = true;
          i++;
          continue;
        }
        
        if (char === '"') {
          result += char;
          inString = !inString;
          i++;
          continue;
        }
        
        if (inString) {
          // Inside a string value
          if (char === '\n') {
            // Escape literal newline
            result += '\\n';
          } else if (char === '\r') {
            // Escape carriage return
            result += '\\r';
          } else if (char === '\t') {
            // Escape tab (for consistency)
            result += '\\t';
          } else {
            result += char;
          }
        } else {
          // Outside string, keep as-is
          result += char;
        }
        
        i++;
      }
      
      return result;
    } catch (error) {
      console.warn('[Tool Parser] Failed to repair JSON:', error);
      return null;
    }
  }
}

