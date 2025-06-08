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
  /**
   * An user-sent event to initiate the agent.
   */
  StateAgentSettingsEvent = 'agent-settings',
}

export interface AgentSettings {
  kind: CoderAgentEvent.StateAgentSettingsEvent;
  workspacePath: string;
}

export interface ToolCallConfirmation {
  kind: CoderAgentEvent.ToolCallConfirmationEvent;
}

export interface ToolCallUpdate {
  kind: CoderAgentEvent.ToolCallUpdateEvent;
}

export interface TextContent {
  kind: CoderAgentEvent.TextContentEvent;
}

export interface StateChange {
  kind: CoderAgentEvent.StateChangeEvent;
}

export type CoderAgentMessage =
  | AgentSettings
  | ToolCallConfirmation
  | ToolCallUpdate
  | TextContent
  | StateChange;
