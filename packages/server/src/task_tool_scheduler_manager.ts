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
          let overallTaskState: TaskState = TaskState.Completed;
          const allMessages: string[] = [];

          completedToolCalls.forEach((ctc) => {
            const finalArtifact: Artifact = {
              artifactId: `tool-${ctc.request.callId}-output`,
              parts: [
                {
                  kind: 'text',
                  text: ctc.response.resultDisplay,
                } as Part,
              ], // TODO: Handle different Part kinds
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
              overallTaskState = TaskState.Failed;
              allMessages.push(
                `Tool '${ctc.request.name}' (${ctc.request.callId}) failed: ${ctc.response.resultDisplay}`,
              );
            } else if (ctc.status === 'cancelled') {
              // If any tool is cancelled, the task might be considered Canceled or Failed
              // For now, let's lean towards Canceled if not already Failed
              if (overallTaskState !== TaskState.Failed) {
                overallTaskState = TaskState.Canceled;
              }
              allMessages.push(
                `Tool '${ctc.request.name}' (${ctc.request.callId}) was cancelled: ${ctc.response.resultDisplay}`,
              );
            } else {
              allMessages.push(
                `Tool '${ctc.request.name}' (${ctc.request.callId}) completed successfully.`,
              );
            }
          });

          const statusMessage: Message = {
            kind: 'message',
            role: 'agent',
            parts: [
              {
                kind: 'text',
                text: allMessages.join('\n') || 'All tool calls processed.',
              } as Part,
            ],
            messageId: `status-${taskId}-allcomplete-${Date.now()}`,
            taskId,
            contextId,
          };

          const statusEvent: TaskStatusUpdateEvent = {
            kind: 'status-update',
            taskId,
            contextId,
            status: {
              state: overallTaskState,
              message: statusMessage,
              timestamp: new Date().toISOString(),
            },
            final: true,
          };
          eventBus.publish(statusEvent);
          this.schedulers.delete(taskId); // Clean up scheduler instance
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
              final: false, // Individual tool updates are not final for the task
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
        return TaskState.Submitted;
      case 'awaiting_approval':
        // This state in CoreToolScheduler means it's paused, waiting for user confirmation.
        // For A2A, this translates to InputRequired, as the system needs external input to proceed.
        return TaskState.InputRequired;
      case 'executing':
        return TaskState.Working;
      case 'success':
        // Individual tool success is part of an ongoing "Working" state for the overall task.
        // The final "Completed" state is determined in onAllToolCallsComplete.
        return TaskState.Working;
      case 'error':
        return TaskState.Failed;
      case 'cancelled':
        return TaskState.Canceled;
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

  scheduleToolCalls(
    taskId: string,
    contextId: string,
    requests: ToolCallRequestInfo | ToolCallRequestInfo[],
    eventBus: IExecutionEventBus,
  ): void {
    const scheduler = this.getOrCreateScheduler(taskId, contextId, eventBus);
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
        state: TaskState.Submitted, // Or TaskState.Working if tools start immediately
        message: initialStatusMessage,
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(initialStatusEvent);
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
