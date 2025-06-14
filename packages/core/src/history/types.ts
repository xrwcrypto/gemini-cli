/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content } from '@google/genai';

// ===========================================================================
// 1. Core Context Management
// ===========================================================================

/**
 * The main stateful object for a chat session. It owns the context tree
 * and the staging area for the upcoming turn.
 */
export interface ConversationContext {
  rootNode: TurnNode;
  currentNodeId: string;
  stagingArea: StagingArea;
}

/**
 * A temporary area where parts of the next turn are assembled before
 * being committed to the context tree. This allows local commands
 * like "@file" or "/subtask" to manipulate the context of the upcoming
 * turn before it is sent to the model.
 */
export interface StagingArea {
  // An array of payloads that will be added to the tree when the turn is finalized.
  stagedPayloads: TurnPayload[];
}

// ===========================================================================
// 2. Context Tree Node and Payloads
// ===========================================================================

/**
 * The core building block of the context tree. Each node represents a
 * distinct event in the conversation.
 */
export interface TurnNode {
  id: string; // Unique ID for this turn
  parentId: string | null; // ID of the parent turn, null for the root
  children: TurnNode[]; // For branching and subtasks
  timestamp: number;
  payload: TurnPayload; // The actual content of the turn
  metadata: TurnMetadata; // App-level annotations
}

/**
 * A discriminated union for the different types of events/turns that can
 * occur in the conversation.
 *
 * The payload contains the core data for the turn, which is often what
 * gets processed and sent to the LLM.
 */
export type TurnPayload =
  | UserMessageTurn
  | ModelResponseTurn
  | ToolCallTurn
  | ToolResultTurn
  | FileContentTurn
  | ContextManagementTurn
  | TaskBoundaryTurn
  | TaskSummaryTurn;

// --- Payload Type Interfaces ---

export interface UserMessageTurn {
  type: 'user_message';
  text: string;
}

export interface ModelResponseTurn {
  type: 'model_response';
  // The raw Content object from the API for perfect recall.
  rawContent: Content;
  // The processed text, for easy display.
  displayText: string;
}

export interface ToolCallTurn {
  type: 'tool_call';
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultTurn {
  type: 'tool_result';
  callId: string; // Links back to the ToolCallTurn
  toolName: string;
  result: unknown; // The data returned by the tool
  // Optional display version for the UI.
  displayResult?: string;
}

/**
 * Represents a file's content that is included as context for a turn.
 * This is the result of a file being loaded, not the act of tracking it.
 */
export interface FileContentTurn {
  type: 'file_content';
  filePath: string;
  // Store a hash to detect if the file has changed on disk.
  contentHash: string;
  /**
   * Manages the state of the file with respect to the Gemini File API.
   * This allows for intelligent caching and referencing of uploaded files.
   */
  fileApi?: {
    status: 'pending' | 'uploading' | 'completed' | 'failed';
    // The URI returned by the File API (e.g., 'files/...')
    fileUri?: string;
    // When the uploaded file expires (timestamp).
    expirationTime?: number;
  };
  // The actual content is stored for direct embedding (fallback) and local use.
  content?: string;
}

/**
 * Represents an action that manages the conversational context itself,
 * such as tracking or untracking a file.
 */
export interface ContextManagementTurn {
  type: 'context_management';
  action: 'track_file' | 'untrack_file';
  filePath: string;
}

/**
 * Marks a boundary for a subtask, defining how the history should be
 * transformed for this new branch.
 */
export interface TaskBoundaryTurn {
  type: 'task_boundary';
  status: 'start' | 'end' | 'error';
  description: string; // e.g., "Starting subtask: Refactor auth.py"
  // Defines how to treat the history from the parent branch.
  transformation: HistoryTransformation;
}

/**
 * Represents the compressed summary of a completed task branch.
 * This acts like a "merge commit" in the context tree, summarizing the
 * outcome of a subtask while retaining a link to its full history.
 */
export interface TaskSummaryTurn {
  type: 'task_summary';
  // The text that summarizes the outcome of the subtask.
  summaryText: string;
  // The ID of the TaskBoundaryTurn that started the completed branch.
  // This allows for "expanding" the summary to view the original history.
  sourceBranchRootId: string;
}

/**
 * Defines the transformation rule for how history from a parent branch
 * should be handled when creating a new subtask or branch.
 */
export type HistoryTransformation =
  | { type: 'clear' } // Start with a clean slate.
  | { type: 'clone' } // Inherit the full history.
  | { type: 'compress'; turns: number }; // Take only the last N turns.

// ===========================================================================
// 3. Metadata and Extensibility
// ===========================================================================

/**
 * Contains application-level annotations for a turn.
 *
 * This data is used for internal logic, UI rendering, and extensibility,
 * and is not typically sent to the LLM.
 */
export interface TurnMetadata {
  // Who initiated this turn?
  source: 'user' | 'model' | 'system';
  // Is this file "ambient" (tracked but not necessarily sent to LLM)?
  isAmbient?: boolean;
  // Link turns to a specific subtask.
  taskId?: string;
  // Should this turn be hidden from the LLM when generating history?
  // Perfect for system messages, internal notes, or raw tool results
  // that have a cleaner summary for the model.
  isHiddenFromLlm?: boolean;
  /**
   * A generic property for extensions to store their own metadata.
   * It's recommended to use a unique key for your extension to avoid
   * collisions.
   *
   * @example
   * custom: {
   *   'my-debugger-extension': {
   *     breakPoint: true,
   *   }
   * }
   */
  custom?: Record<string, unknown>;
}
