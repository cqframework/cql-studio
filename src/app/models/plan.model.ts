// Author: Preston Lee

/**
 * Represents a single step in an execution plan
 */
export interface PlanStep {
  id: string;
  number: number;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  toolCallId?: string; // Optional link to tool call that executes this step
}

/**
 * Represents a complete execution plan
 */
export interface Plan {
  id: string;
  steps: PlanStep[];
  createdAt: Date;
  description?: string; // Optional overall plan description
}

/**
 * Status of plan execution
 */
export type PlanExecutionStatus = 
  | 'not-started'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

