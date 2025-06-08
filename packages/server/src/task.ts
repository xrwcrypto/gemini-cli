/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  CoreToolScheduler,
  GeminiClient,
  ServerGeminiStreamEvent,
  ToolCallConfirmationDetails,
  GeminiEventType,
  CompletedToolCall,
  ToolCall,
  ToolConfirmationOutcome,
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ApprovalMode,
  // Tool, // Unused import
  ServerGeminiErrorEvent,
} from '@gemini-code/core';
import {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskState,
  Message,
  Part,
  Artifact,
  RequestContext,
  IExecutionEventBus,
  schema,
} from '@gemini-code/a2alib';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

import {
  CoderAgentEvent,
  CoderAgentMessage,
  StateChange,
  ToolCallConfirmation,
  ToolCallUpdate,
  TextContent,
} from './types.js';
import { PartUnion } from '@google/genai';

interface ToolStatusMessagePayload {
  request: ToolCallRequestInfo;
  status: string;
  confirmationDetails?: ToolCallConfirmationDetails;
  response?: ToolCallResponseInfo;
}

export class Task {
  id: string;
  contextId: string;
  scheduler: CoreToolScheduler;
  config: Config;
  geminiClient: GeminiClient;
  pendingToolConfirmationDetails: Map<string, ToolCallConfirmationDetails>;
  taskState: TaskState;
  accumulatedContent: string;
  eventBus: IExecutionEventBus;
  completedToolCalls: CompletedToolCall[];

  // For tool waiting logic
  private pendingToolCallIds: Set<string> = new Set();
  private toolCompletionPromise?: Promise<void>;
  private toolCompletionNotifier?: {
    resolve: () => void;
    reject: (reason?: Error) => void;
  };

  constructor(
    id: string,
    contextId: string,
    config: Config,
    eventBus: IExecutionEventBus,
  ) {
    this.id = id;
    this.contextId = contextId;
    this.config = config;
    this.scheduler = this.createScheduler();
    this.geminiClient = new GeminiClient(this.config);
    this.pendingToolConfirmationDetails = new Map<
      string,
      ToolCallConfirmationDetails
    >();
    this.taskState = TaskState.Submitted;
    this.accumulatedContent = '';
    this.eventBus = eventBus;
    this.completedToolCalls = [];
    this._resetToolCompletionPromise();
  }

  private _resetToolCompletionPromise(): void {
    this.toolCompletionPromise = new Promise((resolve, reject) => {
      this.toolCompletionNotifier = { resolve, reject };
    });
    // If there are no pending calls when reset, resolve immediately.
    if (this.pendingToolCallIds.size === 0 && this.toolCompletionNotifier) {
      this.toolCompletionNotifier.resolve();
    }
  }

  registerToolCall(toolCallId: string): void {
    if (!this.pendingToolCallIds.has(toolCallId)) {
      const wasEmpty = this.pendingToolCallIds.size === 0;
      this.pendingToolCallIds.add(toolCallId);
      if (wasEmpty) {
        this._resetToolCompletionPromise();
      }
      logger.info(
        `[Task] Registered tool call: ${toolCallId}. Pending: ${this.pendingToolCallIds.size}`,
      );
    }
  }

  resolveToolCall(toolCallId: string): void {
    if (this.pendingToolCallIds.has(toolCallId)) {
      this.pendingToolCallIds.delete(toolCallId);
      logger.info(
        `[Task] Resolved tool call: ${toolCallId}. Pending: ${this.pendingToolCallIds.size}`,
      );
      if (this.pendingToolCallIds.size === 0 && this.toolCompletionNotifier) {
        this.toolCompletionNotifier.resolve();
      }
    }
  }

  async waitForPendingTools(): Promise<void> {
    if (this.pendingToolCallIds.size === 0) {
      return Promise.resolve();
    }
    logger.info(
      `[Task] Waiting for ${this.pendingToolCallIds.size} pending tool(s)...`,
    );
    return this.toolCompletionPromise;
  }

  cancelPendingTools(reason: string): void {
    if (this.pendingToolCallIds.size > 0) {
      logger.info(
        `[Task] Cancelling all ${this.pendingToolCallIds.size} pending tool calls. Reason: ${reason}`,
      );
    }
    if (this.toolCompletionNotifier) {
      this.toolCompletionNotifier.reject(new Error(reason));
    }
    this.pendingToolCallIds.clear();
    // Reset the promise for any future operations, ensuring it's in a clean state.
    this._resetToolCompletionPromise();
  }

  private _createTextMessage(
    text: string,
    role: 'agent' | 'user' = 'agent',
  ): Message {
    return {
      kind: 'message',
      role,
      parts: [{ kind: 'text', text }],
      messageId: uuidv4(),
      taskId: this.id,
      contextId: this.contextId,
    };
  }

  private _createStatusUpdateEvent(
    stateToReport: TaskState,
    coderAgentMessage: CoderAgentMessage,
    message?: Message,
    final = false,
    timestamp?: string,
  ): TaskStatusUpdateEvent {
    const metadata: { coderAgent: CoderAgentMessage } = {
      coderAgent: coderAgentMessage,
    };
    return {
      kind: 'status-update',
      taskId: this.id,
      contextId: this.contextId,
      status: {
        state: stateToReport,
        message, // Shorthand property
        timestamp: timestamp || new Date().toISOString(),
      },
      final,
      metadata,
    };
  }

  setTaskStateAndPublishUpdate(
    newState: TaskState,
    coderAgentMessage: CoderAgentMessage,
    messageText?: string,
    messageParts?: Part[], // For more complex messages
    final = false,
  ): void {
    this.taskState = newState;
    let message: Message | undefined;

    if (messageText) {
      message = this._createTextMessage(messageText);
    } else if (messageParts) {
      message = {
        kind: 'message',
        role: 'agent',
        parts: messageParts,
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      };
    }

    const event = this._createStatusUpdateEvent(
      this.taskState,
      coderAgentMessage,
      message,
      final,
    );
    this.eventBus.publish(event);
  }

  private _schedulerOutputUpdate(
    toolCallId: string,
    outputChunk: string,
  ): void {
    logger.info(
      '[Task] Scheduler output update for tool call ' +
        toolCallId +
        ': ' +
        outputChunk,
    );
    const artifact: Artifact = {
      artifactId: `tool-${toolCallId}-output`,
      parts: [
        {
          kind: 'text',
          text: outputChunk,
        } as Part,
      ],
    };
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId: this.id,
      contextId: this.contextId,
      artifact,
      append: true,
      lastChunk: false,
    };
    this.eventBus.publish(artifactEvent);
  }

  private async _schedulerAllToolCallsComplete(
    completedToolCalls: CompletedToolCall[],
  ): Promise<void> {
    logger.info(
      '[Task] All tool calls completed by scheduler (batch):',
      completedToolCalls.map((tc) => tc.request.callId),
    );
    this.completedToolCalls.push(...completedToolCalls);
    completedToolCalls.forEach((tc) => {
      // Ensure resolution, though _schedulerToolCallsUpdate should handle terminal states.
      this.resolveToolCall(tc.request.callId);
      const statusMessage: Message = this.toolStatusMessage(
        tc,
        this.id,
        this.contextId,
      );
      const toolCallUpdate: ToolCallUpdate = {
        kind: CoderAgentEvent.ToolCallUpdateEvent,
      };
      const event = this._createStatusUpdateEvent(
        this.taskState,
        toolCallUpdate,
        statusMessage,
        false,
      );
      this.eventBus.publish(event);
    });
  }

  private _schedulerToolCallsUpdate(toolCalls: ToolCall[]): void {
    logger.info(
      '[Task] Scheduler tool calls updated:',
      toolCalls.map((tc) => `${tc.request.callId} (${tc.status})`),
    );

    const nonApprovalToolMessageParts: Part[] = [];
    const approvalToolMessageParts: Part[] = [];
    let isAwaitingApproval = false;
    const taskStateForNonApprovalUpdates = this.taskState;

    toolCalls.forEach((tc) => {
      const toolSpecificMessage: Message = this.toolStatusMessage(
        tc,
        this.id,
        this.contextId,
      );

      // Register tool call if it's new and being processed by scheduler
      // (scheduled, executing, or awaiting_approval are good indicators)
      if (['scheduled', 'executing', 'awaiting_approval'].includes(tc.status)) {
        this.registerToolCall(tc.request.callId);
      }

      // Resolve tool call if it has reached a terminal state
      if (['success', 'error', 'cancelled'].includes(tc.status)) {
        this.resolveToolCall(tc.request.callId);
      }

      if (tc.status === 'awaiting_approval' && tc.confirmationDetails) {
        this.pendingToolConfirmationDetails.set(
          tc.request.callId,
          tc.confirmationDetails,
        );
        isAwaitingApproval = true;
        approvalToolMessageParts.push(...toolSpecificMessage.parts);
      } else {
        nonApprovalToolMessageParts.push(...toolSpecificMessage.parts);
      }
    });

    if (nonApprovalToolMessageParts.length > 0) {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        parts: nonApprovalToolMessageParts,
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      };
      const toolCallUpdate: ToolCallUpdate = {
        kind: CoderAgentEvent.ToolCallUpdateEvent,
      };
      const event = this._createStatusUpdateEvent(
        taskStateForNonApprovalUpdates,
        toolCallUpdate,
        message,
        false,
      );
      this.eventBus.publish(event);
    }

    if (isAwaitingApproval) {
      if (this.config.getApprovalMode() === ApprovalMode.YOLO) {
        logger.info('[Task] YOLO mode enabled. Auto-approving all tool calls.');
        toolCalls.forEach((tc) => {
          if (tc.status === 'awaiting_approval' && tc.confirmationDetails) {
            tc.confirmationDetails.onConfirm(
              ToolConfirmationOutcome.ProceedOnce,
            );
            this.pendingToolConfirmationDetails.delete(tc.request.callId);
          }
        });
        return;
      }
      logger.info(
        '[Task] One or more tools require user confirmation. Setting task state to InputRequired by scheduler update.',
      );
      this.taskState = schema.TaskState.InputRequired; // State changes here

      const messageParts =
        approvalToolMessageParts.length > 0
          ? approvalToolMessageParts
          : [
              {
                kind: 'text',
                text: 'Input required for tool execution.',
              } as Part,
            ];
      const message: Message = {
        kind: 'message',
        role: 'agent',
        parts: messageParts,
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      };
      const toolCallConfirmation: ToolCallConfirmation = {
        kind: CoderAgentEvent.ToolCallConfirmationEvent,
      };
      // This InputRequired is specific to tool approval, not end of turn.
      // The agent.ts will send the final InputRequired after waiting.
      const event = this._createStatusUpdateEvent(
        this.taskState,
        toolCallConfirmation,
        message,
        true,
      ); // final: true for this specific A2A interaction point
      this.eventBus.publish(event);
    }
  }

  private createScheduler(): CoreToolScheduler {
    const scheduler = new CoreToolScheduler({
      toolRegistry: this.config.getToolRegistry(),
      outputUpdateHandler: this._schedulerOutputUpdate.bind(this),
      onAllToolCallsComplete: this._schedulerAllToolCallsComplete.bind(this),
      onToolCallsUpdate: this._schedulerToolCallsUpdate.bind(this),
    });
    return scheduler;
  }

  private toolStatusMessage(
    tc: ToolCall,
    taskId: string,
    contextId: string,
  ): Message {
    const messageParts: Part[] = [];
    const dataPayload: ToolStatusMessagePayload = {
      request: tc.request,
      status: tc.status,
    };

    switch (tc.status) {
      case 'awaiting_approval':
        dataPayload.confirmationDetails = tc.confirmationDetails;
        break;
      case 'error':
      case 'success':
        dataPayload.response = tc.response;
        break;
      case 'cancelled':
      case 'executing':
      case 'scheduled':
      case 'validating':
        // No additional properties needed for these statuses
        break;
      default:
        break;
    }

    messageParts.push({
      kind: 'data',
      data: dataPayload as unknown,
    } as Part);

    return {
      kind: 'message',
      role: 'agent',
      parts: messageParts,
      messageId: uuidv4(),
      taskId,
      contextId,
    };
  }

  async acceptAgentMessage(event: ServerGeminiStreamEvent): Promise<void> {
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    switch (event.type) {
      case GeminiEventType.Content:
        logger.info('[Task] Accumulating agent message content...');
        this.accumulatedContent += event.value;
        break;
      case GeminiEventType.ToolCallRequest:
        logger.info('[Task] Received tool call request from LLM:', event.value);
        this.flushAccumulatedContent();
        this.setTaskStateAndPublishUpdate(
          schema.TaskState.Working,
          stateChange,
        );
        // The scheduler will call _schedulerToolCallsUpdate, which will register the tool.
        await this.scheduler.schedule(event.value);
        break;
      case GeminiEventType.ToolCallResponse:
        // This event type from ServerGeminiStreamEvent might be for when LLM *generates* a tool response part.
        // The actual execution result comes via user message.
        logger.info(
          '[Task] Received tool call response from LLM (part of generation):',
          event.value,
        );
        this.flushAccumulatedContent();
        // this._setTaskStateAndPublishUpdate(schema.TaskState.Working, "LLM generated tool response part");
        break;
      case GeminiEventType.ToolCallConfirmation:
        // This is when LLM requests confirmation, not when user provides it.
        logger.info(
          '[Task] Received tool call confirmation request from LLM:',
          event.value.request.callId,
        );
        this.flushAccumulatedContent();
        this.pendingToolConfirmationDetails.set(
          event.value.request.callId,
          event.value.details,
        );
        // This will be handled by the scheduler and _schedulerToolCallsUpdate will set InputRequired if needed.
        // No direct state change here, scheduler drives it.
        break;
      case GeminiEventType.UserCancelled:
        logger.info('[Task] Received user cancelled event from LLM stream.');
        this.flushAccumulatedContent();
        this.cancelPendingTools('User cancelled via LLM stream event');
        this.setTaskStateAndPublishUpdate(
          schema.TaskState.Canceled,
          stateChange,
          'Task cancelled by user',
          undefined,
          true,
        );
        break;
      case GeminiEventType.Error:
      default: {
        // Block scope for lexical declaration
        const errorEvent = event as ServerGeminiErrorEvent; // Type assertion
        const errorMessage =
          errorEvent.value?.message || 'Unknown error from LLM stream';
        logger.error(
          '[Task] Received error event from LLM stream:',
          errorMessage,
        );
        this.flushAccumulatedContent();
        this.cancelPendingTools(`LLM stream error: ${errorMessage}`);
        this.setTaskStateAndPublishUpdate(
          schema.TaskState.Failed,
          stateChange,
          `Task failed: ${errorMessage}`,
          undefined,
          true,
        );
        break;
      }
    }
  }

  private async _handleToolConfirmationPart(part: Part): Promise<boolean> {
    if (
      part.kind !== 'data' ||
      !part.data ||
      typeof part.data.callId !== 'string' ||
      typeof part.data.outcome !== 'string'
    ) {
      return false;
    }

    const callId = part.data.callId as string;
    const outcomeString = part.data.outcome as string;
    let confirmationOutcome: ToolConfirmationOutcome | undefined;

    if (outcomeString === 'ProceedOnce') {
      confirmationOutcome = ToolConfirmationOutcome.ProceedOnce;
    } else if (outcomeString === 'Cancel') {
      confirmationOutcome = ToolConfirmationOutcome.Cancel;
    } else {
      logger.warn(
        `[Task] Unknown tool confirmation outcome: "${outcomeString}" for callId: ${callId}`,
      );
      return false;
    }

    const confirmationDetails = this.pendingToolConfirmationDetails.get(callId);
    if (!confirmationDetails) {
      logger.warn(
        `[Task] Received tool confirmation for unknown or already processed callId: ${callId}`,
      );
      return false;
    }

    logger.info(
      `[Task] Handling tool confirmation for callId: ${callId} with outcome: ${outcomeString}`,
    );
    try {
      // This will trigger the scheduler to continue or cancel the specific tool.
      // The scheduler's onToolCallsUpdate will then reflect the new state (e.g., executing or cancelled).
      await confirmationDetails.onConfirm(confirmationOutcome);
      this.pendingToolConfirmationDetails.delete(callId); // Remove once successfully passed to scheduler
      // If outcome is Cancel, scheduler should update status to 'cancelled', which then resolves the tool.
      // If ProceedOnce, scheduler updates to 'executing', then eventually 'success'/'error', which resolves.
      return true;
    } catch (error) {
      logger.error(
        `[Task] Error during tool confirmation for callId ${callId}:`,
        error,
      );
      // If confirming fails, we should probably mark this tool as failed.
      this.resolveToolCall(callId); // Resolve it as it won't proceed.
      const errorMessageText =
        error instanceof Error
          ? error.message
          : `Error processing tool confirmation for ${callId}`;
      const message = this._createTextMessage(errorMessageText);
      const toolCallUpdate: ToolCallUpdate = {
        kind: CoderAgentEvent.ToolCallUpdateEvent,
      };
      const event = this._createStatusUpdateEvent(
        this.taskState,
        toolCallUpdate,
        message,
        false,
      );
      this.eventBus.publish(event);
      return false;
    }
  }

  async *sendCompletedToolsToLlm(
    aborted: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (this.completedToolCalls.length === 0) {
      yield* (async function* () {})(); // Yield nothing
      return;
    }

    const llmParts: PartUnion[] = [];
    logger.info(
      `[Task] Feeding ${this.completedToolCalls.length} tool responses to LLM.`,
    );
    for (const completedToolCall of this.completedToolCalls) {
      logger.info(
        `[Task] Adding tool response for "${completedToolCall.request.name}" (callId: ${completedToolCall.request.callId}) to LLM input.`,
      );
      const responseParts = completedToolCall.response.responseParts;
      if (Array.isArray(responseParts)) {
        llmParts.push(...responseParts);
      } else {
        llmParts.push(responseParts);
      }
    }
    this.completedToolCalls = [];

    logger.info('[Task] Sending new parts to LLM:', llmParts);
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    // Set task state to working as we are about to call LLM
    this.setTaskStateAndPublishUpdate(schema.TaskState.Working, stateChange);
    yield* this.geminiClient.sendMessageStream(llmParts, aborted);
  }

  async *acceptUserMessage(
    requestContext: RequestContext,
    aborted: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    logger.info('[Task] Processing user message:', requestContext.userMessage);

    const userMessage = requestContext.userMessage;
    const llmParts: PartUnion[] = [];
    let anyConfirmationHandled = false;
    let hasContentForLlm = false;

    for (const part of userMessage.parts) {
      const confirmationHandled = await this._handleToolConfirmationPart(part);
      if (confirmationHandled) {
        anyConfirmationHandled = true;
        // If a confirmation was handled, the scheduler will now run the tool (or cancel it).
        // We don't send anything to the LLM for this part.
        // The subsequent tool execution will eventually lead to resolveToolCall.
        continue;
      }

      if (part.kind === 'text') {
        llmParts.push({ text: part.text });
        hasContentForLlm = true;
      }
    }

    if (hasContentForLlm) {
      logger.info('[Task] Sending new parts to LLM:', llmParts);
      const stateChange: StateChange = {
        kind: CoderAgentEvent.StateChangeEvent,
      };
      // Set task state to working as we are about to call LLM
      this.setTaskStateAndPublishUpdate(schema.TaskState.Working, stateChange);
      yield* this.geminiClient.sendMessageStream(llmParts, aborted);
    } else if (anyConfirmationHandled) {
      logger.info(
        '[Task] User message only contained tool confirmations. Scheduler is active. No new input for LLM this turn.',
      );
      // Ensure task state reflects that scheduler might be working due to confirmation.
      // If scheduler is active, it will emit its own status updates.
      // If all pending tools were just confirmed, waitForPendingTools will handle the wait.
      // If some tools are still pending approval, scheduler would have set InputRequired.
      // If not, and no new text, we are just waiting.
      if (
        this.pendingToolCallIds.size > 0 &&
        this.taskState !== schema.TaskState.InputRequired
      ) {
        const stateChange: StateChange = {
          kind: CoderAgentEvent.StateChangeEvent,
        };
        this.setTaskStateAndPublishUpdate(
          schema.TaskState.Working,
          stateChange,
        ); // Reflect potential background activity
      }
      yield* (async function* () {})(); // Yield nothing
    } else {
      logger.info(
        '[Task] No relevant parts in user message for LLM interaction or tool confirmation.',
      );
      // If there's no new text and no confirmations, and no pending tools,
      // it implies we might need to signal input required if nothing else is happening.
      // However, the agent.ts will make this determination after waitForPendingTools.
      yield* (async function* () {})(); // Yield nothing
    }
  }

  flushAccumulatedContent(): boolean {
    if (this.accumulatedContent === '') {
      return false;
    }
    logger.info('[Task] Flushing accumulated content to event bus.');
    const message = this._createTextMessage(this.accumulatedContent);
    const textContent: TextContent = {
      kind: CoderAgentEvent.TextContentEvent,
    };
    this.eventBus.publish(
      this._createStatusUpdateEvent(
        this.taskState,
        textContent,
        message,
        false,
      ),
    );
    this.accumulatedContent = '';
    return true;
  }
}
