/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  CoreToolScheduler,
  ToolCall,
  ToolCallRequestInfo,
  CompletedToolCall,
} from '@gemini-code/core';
import {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskState,
  Message,
  Part,
  Artifact,
} from '@gemini-code/a2alib';
import { IExecutionEventBus } from '@gemini-code/a2alib';

export class TaskToolSchedulerManager {
  private schedulers: Map<string, CoreToolScheduler> = new Map();
  private completionResolvers: Map<string, (result: CompletedToolCall[]) => void> = new Map();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private getOrCreateScheduler(
    taskId: string,
    contextId: string,
    eventBus: IExecutionEventBus,
  ): CoreToolScheduler {
    if (!this.schedulers.has(taskId)) {
      const scheduler = new CoreToolScheduler({
        toolRegistry: this.config.getToolRegistry(),
        outputUpdateHandler: (toolCallId: string, outputChunk: string) => {
          // Corrected signature
          const artifact: Artifact = {
            artifactId: `tool-${toolCallId}-output`,
            parts: [
              {
                kind: 'text',
                text: outputChunk,
              } as Part,
            ], // TODO: Handle different Part kinds based on tool output type
            // metadata: { // Removed metadata related to isErrorOutput
            //   source: 'stdout', // Assuming stdout for now
            // },
          };
          const artifactEvent: TaskArtifactUpdateEvent = {
            kind: 'artifact-update',
            taskId,
            contextId,
            artifact,
            append: true,
            lastChunk: false, // This will be true for the final result from onAllToolCallsComplete
          };
          eventBus.publish(artifactEvent);
        },
        onAllToolCallsComplete: (completedToolCalls: CompletedToolCall[]) => {
          let determinedState: TaskState;
          const allMessages: string[] = [];
          let hasErrors = false;
          let hasCancellations = false;
          let allSuccessful = true; // Assume success until proven otherwise
          if (this.completionResolvers.has(taskId)) {
            const resolve = this.completionResolvers.get(taskId)!;
            resolve(completedToolCalls);
            this.completionResolvers.delete(taskId); // Clean up the resolver
          }

          if (completedToolCalls.length === 0) {
            // No tools were actually called, or all were filtered out before execution.
            // This scenario implies the agent's turn might be over without tool interaction.
            // We'll treat this as "Working" and let the agent decide the next step.
            determinedState = TaskState.Working;
            allMessages.push('No tool calls were executed. Agent processing.');
            allSuccessful = false; // Not a tool success case
          } else {
            completedToolCalls.forEach((ctc) => {
              const finalArtifact: Artifact = {
                artifactId: `tool-${ctc.request.callId}-output`,
                parts: [
                  {
                    kind: 'text',
                    text: ctc.response.resultDisplay,
                  } as Part,
                ],
                metadata: {
                  status: ctc.status,
                },
              };
              const artifactEvent: TaskArtifactUpdateEvent = {
                kind: 'artifact-update',
                taskId,
                contextId,
                artifact: finalArtifact,
                append: false,
                lastChunk: true,
              };
              eventBus.publish(artifactEvent);

              if (ctc.status === 'error') {
                hasErrors = true;
                allSuccessful = false;
                allMessages.push(
                  `Tool '${ctc.request.name}' (${ctc.request.callId}) failed: ${ctc.response.resultDisplay}. Please advise on how to proceed.`,
                );
              } else if (ctc.status === 'cancelled') {
                hasCancellations = true;
                allSuccessful = false;
                allMessages.push(
                  `Tool '${ctc.request.name}' (${ctc.request.callId}) was cancelled: ${ctc.response.resultDisplay}`,
                );
              } else {
                // success
                allMessages.push(
                  `Tool '${ctc.request.name}' (${ctc.request.callId}) completed successfully.`,
                );
              }
            });
          }

          if (hasErrors) {
            determinedState = TaskState.InputRequired;
          } else if (hasCancellations) {
            determinedState = TaskState.Canceled;
          } else if (allSuccessful && completedToolCalls.length > 0) {
            // All tools ran and were successful
            determinedState = TaskState.Working;
            allMessages.push(
              'All tools completed successfully. Agent processing results.',
            );
          } else if (!allSuccessful && completedToolCalls.length > 0) {
            // Mixed results, but no errors that require immediate input, and not all cancelled.
            // This path should ideally be covered by hasErrors or hasCancellations leading to InputRequired/Canceled.
            // If we reach here, it implies some tools succeeded, some were cancelled, but none errored to force InputRequired.
            // Defaulting to Working, as the agent might still process partial results.
            determinedState = TaskState.Working;
            allMessages.push(
              'Tool processing finished with mixed results. Agent continuing.',
            );
          } else {
            // Fallback for empty completedToolCalls or other unhandled scenarios.
            determinedState = TaskState.Working;
            if (allMessages.length === 0)
              allMessages.push(
                'Tool processing phase complete. Agent continuing.',
              );
          }

          const statusMessage: Message = {
            kind: 'message',
            role: 'agent',
            parts: [
              {
                kind: 'text',
                text: allMessages.join('\n'),
              } as Part,
            ],
            messageId: `status-${taskId}-allcomplete-${Date.now()}`,
            taskId,
            contextId,
          };

          // `final` is true if the state is InputRequired or Canceled.
          // For Working, it's false, as the agent is expected to continue.
          const isFinalEvent =
            determinedState === TaskState.InputRequired ||
            determinedState === TaskState.Canceled;

          const statusEvent: TaskStatusUpdateEvent = {
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: determinedState,
              message: statusMessage,
              timestamp: new Date().toISOString(),
            },
            final: isFinalEvent,
          };
          eventBus.publish(statusEvent);

          // Clean up scheduler instance only if the task is Canceled.
          // If InputRequired or Working, the scheduler might be needed again or is still part of an ongoing task flow.
          if (determinedState === TaskState.Canceled) {
            this.schedulers.delete(taskId);
          }
        },
        onToolCallsUpdate: (updatedToolCalls: ToolCall[]) => {
          updatedToolCalls.forEach((tc) => {
            const a2aState = this.mapCoreStatusToA2ATaskState(
              tc.status,
              tc.request.name,
            );
            // Avoid sending redundant "Working" states if the overall task is already "Working"
            // or if it's a success state that will be handled by onAllToolCallsComplete more definitively
            if (tc.status === 'success') {
              // Success for an individual tool is handled by onAllToolCallsComplete for its artifact
              // and the overall task status. We don't send a separate "Working" or "Completed" here.
              return;
            }

            const messageParts: Part[] = [];
            let messageText = `Tool '${tc.request.name}' (${tc.request.callId}) status: ${tc.status}.`;
            if (tc.status === 'error' && tc.response?.resultDisplay) {
              messageText = `Tool '${tc.request.name}' (${tc.request.callId}) failed: ${tc.response.resultDisplay}`;
            } else if (
              tc.status === 'cancelled' &&
              tc.response?.resultDisplay
            ) {
              messageText = `Tool '${tc.request.name}' (${tc.request.callId}) cancelled: ${tc.response.resultDisplay}`;
            } else if (tc.status === 'awaiting_approval') {
              messageText = `Tool '${tc.request.name}' (${tc.request.callId}) is awaiting approval. Details: ${JSON.stringify(tc.confirmationDetails)}`;
            }
            messageParts.push({ kind: 'text', text: messageText } as Part);

            const statusMessage: Message = {
              kind: 'message',
              role: 'agent',
              parts: messageParts,
              messageId: `status-${taskId}-${tc.request.callId}-${tc.status}-${Date.now()}`,
              taskId,
              contextId,
            };

            const statusEvent: TaskStatusUpdateEvent = {
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: a2aState,
                message: statusMessage,
                timestamp: new Date().toISOString(),
              },
              // If a2aState is InputRequired, Failed, or Canceled for this specific tool update, it's final for this update path.
              // Otherwise (e.g. Working, Submitted), it's not final for the overall task.
              final: [
                TaskState.InputRequired,
                TaskState.Failed,
                TaskState.Canceled,
              ].includes(a2aState),
            };
            eventBus.publish(statusEvent);
          });
        },
      });
      this.schedulers.set(taskId, scheduler);
    }
    return this.schedulers.get(taskId)!;
  }

  private mapCoreStatusToA2ATaskState(
    coreStatus: ToolCall['status'],
    toolName: string,
  ): TaskState {
    switch (coreStatus) {
      case 'scheduled':
      case 'validating':
        // These are transient states leading to execution or approval.
        // Consider them as 'Working' from A2A perspective as server is processing.
        return TaskState.Working;
      case 'awaiting_approval':
        // This state in CoreToolScheduler means it's paused, waiting for user confirmation.
        // For A2A, this translates to InputRequired, as the system needs external input to proceed.
        return TaskState.InputRequired;
      case 'executing':
        return TaskState.Working;
      case 'success':
        // Individual tool success. The task is still ongoing until all tools complete
        // and the agent decides its next step. So, it's still 'Working' or 'InputRequired'
        // if further agent processing implies needing more from the user.
        // For now, let's keep it as Working, assuming agent will continue.
        // If agent turn ends and more is needed, it should become InputRequired.
        return TaskState.Working; // Or potentially InputRequired based on broader context
      case 'error':
        // Tool specific error. Task should ask for input on how to proceed.
        return TaskState.InputRequired;
      case 'cancelled':
        return TaskState.Canceled; // Tool specific cancellation.
      default: {
        // Ensures all cases are handled if CoreToolScheduler.Status changes
        const exhaustiveCheck: never = coreStatus;
        console.warn(
          `Unknown core tool status encountered for tool '${toolName}': ${exhaustiveCheck}`,
        );
        return TaskState.Unknown;
      }
    }
  }

  async scheduleToolCalls(
    taskId: string,
    contextId: string,
    requests: ToolCallRequestInfo | ToolCallRequestInfo[],
    eventBus: IExecutionEventBus,
  ): Promise<CompletedToolCall[]> {
    const scheduler = this.getOrCreateScheduler(taskId, contextId, eventBus);

    // Create and store the promise resolver
    const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
      this.completionResolvers.set(taskId, resolve);
    });
    scheduler.schedule(requests);

    // Send an initial "Submitted" or "Working" status for the task's tool execution phase
    const initialStatusMessage: Message = {
      kind: 'message',
      role: 'agent',
      parts: [
        {
          kind: 'text',
          text: `Task ${taskId} submitted for tool execution. Requested tools: ${(Array.isArray(requests) ? requests : [requests]).map((r) => r.name).join(', ')}`,
        } as Part,
      ],
      messageId: `initial-status-${taskId}-${Date.now()}`,
      taskId,
      contextId,
    };

    const initialStatusEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: TaskState.Working, // Task is actively working on tools now
        message: initialStatusMessage,
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(initialStatusEvent);
    return completionPromise;
  }

  cancelTask(
    taskId: string,
    contextId: string,
    eventBus: IExecutionEventBus,
    reason: string = 'Cancelled by request',
  ): void {
    const scheduler = this.schedulers.get(taskId);
    if (scheduler) {
      scheduler.cancelAll(reason);
      // The onToolCallsUpdate handler will catch the 'cancelled' status for individual tools,
      // and onAllToolCallsComplete will set the final task status.
      // We can also send an immediate overall Task Canceled event here.
      const cancelStatusMessage: Message = {
        kind: 'message',
        role: 'agent',
        parts: [
          {
            kind: 'text',
            text: `Task ${taskId} cancellation initiated: ${reason}`,
          } as Part,
        ],
        messageId: `cancel-status-${taskId}-${Date.now()}`,
        taskId,
        contextId,
      };
      const cancelEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: TaskState.Canceled,
          message: cancelStatusMessage,
          timestamp: new Date().toISOString(),
        },
        final: true, // This task is now considered finally Canceled by this direct action.
      };
      eventBus.publish(cancelEvent);
      this.schedulers.delete(taskId); // Clean up
    } else {
      console.warn(`No active scheduler found for task ${taskId} to cancel.`);
    }
    
  }
}
