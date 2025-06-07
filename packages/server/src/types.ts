/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Interfaces and enums for the CoderAgent protocol.

export enum CoderAgentEvent {
  /**
   * An event requesting one or more tool call confirmations.
   */
  ToolCallConfirmationEvent = 'tool-call-confirmation',
  /**
   * An event updating on the status of one or more tool calls.
   */
  ToolCallUpdateEvent = 'tool-call-update',
  /**
   * An event providing text updates on the task.
   */
  TextContentEvent = 'text-content',
  /**
   * An event that indicates a change in the task's execution state.
   */
  StateChangeEvent = 'state-change',
}

export interface CoderAgentMetadata {
  kind: CoderAgentEvent;
}
