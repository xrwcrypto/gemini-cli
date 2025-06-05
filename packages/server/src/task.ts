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
import { C } from 'vitest/dist/chunks/reporters.d.C1ogPriE.js';

// import { Message, TaskState, Artifact } from '@gemini-code/a2alib';

export class Task {
  id: string;
  contextId: string;
  scheduler: CoreToolScheduler;
  config: Config;
  geminiClient: GeminiClient;
  pendingToolConfirmationDetails: Map<string, ToolCallConfirmationDetails>;
  taskState: TaskState;
  eventBus: IExecutionEventBus;
  accumulatedContent: string;
  
  constructor(
    id: string,
    contextId: string,
    config: Config,
    geminiClient: GeminiClient,
    pendingToolConfirmationDetails: Map<string, ToolCallConfirmationDetails>,
    taskState: TaskState,
    eventBus: IExecutionEventBus,

  ) {
    this.id = id;
    this.contextId = contextId;
    this.eventBus = eventBus;
    this.scheduler = this.createScheduler(this.id, contextId);
    this.config = config;
    this.geminiClient = geminiClient;
    this.pendingToolConfirmationDetails = pendingToolConfirmationDetails;
    this.taskState = taskState;
    this.accumulatedContent = "";
  }

    private createScheduler(
      taskId: string,
      contextId: string,
    ): CoreToolScheduler {
        const scheduler = new CoreToolScheduler({
          toolRegistry: this.config.getToolRegistry(),
          outputUpdateHandler: (toolCallId: string, outputChunk: string) => {
            console.log("Received output chunk for tool call " + toolCallId + ": " + outputChunk)
            // const artifact: Artifact = {
            //   artifactId: `tool-${toolCallId}-output`,
            //   parts: [
            //     {
            //       kind: 'text',
            //       text: outputChunk,
            //     } as Part,
            //   ],
            // };
            // const artifactEvent: TaskArtifactUpdateEvent = {
            //   kind: 'artifact-update',
            //   taskId,
            //   contextId,
            //   artifact,
            //   append: true,
            //   lastChunk: false,
            // };
            // this.eventBus.publish(artifactEvent);
          },
          onAllToolCallsComplete: (_: CompletedToolCall[]) => {
            console.log("All tool calls completed");
            // completedToolCalls.forEach((ctc) => {
            //   const finalArtifact: Artifact = {
            //     artifactId: `tool-${ctc.request.callId}-output`,
            //     parts: [
            //       {
            //         kind: 'data',
            //         data: ctc,
            //       } as Part,
            //     ],
            //     metadata: {
            //       status: ctc.status,
            //     },
            //   };
            //   const artifactEvent: TaskArtifactUpdateEvent = {
            //     kind: 'artifact-update',
            //     taskId,
            //     contextId,
            //     artifact: finalArtifact,
            //     append: false,
            //     lastChunk: true,
            //   };
            //   this.eventBus.publish(artifactEvent);
            // });
          },
          onToolCallsUpdate: (_: ToolCall[]) => {
            console.log("Tool calls updated");
            // updatedToolCalls.forEach((tc) => {
            //   const messageParts: Part[] = [];
            //   messageParts.push({ kind: 'data', data: tc } as Part);
                                          
            //   const statusMessage: Message = {
            //     kind: 'message',
            //     role: 'agent',
            //     parts: messageParts,
            //     messageId: uuidv4(),
            //     taskId,
            //     contextId,
            //   };
  
            //   const statusEvent: TaskStatusUpdateEvent = {
            //     kind: 'status-update',
            //     taskId,
            //     contextId,
            //     status: {
            //       state: this.taskState,
            //       message: statusMessage,
            //       timestamp: new Date().toISOString(),
            //     },
            //     final: false,
            //   };
            //   this.eventBus.publish(statusEvent);
            // });
          },
        });
        return scheduler;
    }
  // Changes the state and writes to the A2A eventBus
  acceptAgentMessage(event: ServerGeminiStreamEvent): void {
    switch (event.type) {
      case GeminiEventType.Content:
        this.accumulatedContent += event.value;
        break;
      case GeminiEventType.ToolCallRequest:
        this.flushAccumulatedContent();
        this.taskState = schema.TaskState.Working;
        this.eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
          },
          final: true,
        });
        break;
      case GeminiEventType.ToolCallResponse:
        this.flushAccumulatedContent();
        this.taskState = schema.TaskState.Working;
        this.eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
            message: {
              messageId: uuidv4(),
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: "Received tool call response" }],
            },
          },
          final: false,
        })
        break;
      case GeminiEventType.ToolCallConfirmation:
        this.flushAccumulatedContent();
        this.taskState = schema.TaskState.InputRequired;
        this.pendingToolConfirmationDetails.set(event.value.request.callId, event.value.details);
        this.eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
            message: {
              messageId: uuidv4(),
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: "Tool call requires confirmation" }],
            },
          },
          final: true,
        })
        break;
      case GeminiEventType.UserCancelled:
      case GeminiEventType.Error:
          this.flushAccumulatedContent();
        this.eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state:
              event.type === GeminiEventType.Error
                ? schema.TaskState.Failed
                : schema.TaskState.Canceled,
          },
          final: true,
        });
        return;
      default:
        throw new Error("Unhandled agent event type:");
    }
    this.flushAccumulatedContent();
  }

  acceptUserMessage(requestContext: RequestContext, eventBus: IExecutionEventBus) {
    console.log(requestContext);
    console.log(eventBus);

    const userMessage = requestContext.userMessage;
    const toolUsePart = userMessage.parts?.find(
      (part): part is schema.DataPart => part.kind === 'data',
    );
    // if this is in pending tool confirmation details, call callback
    this.pendingToolConfirmationDetails.get("tool call ID")?.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    
    if (toolUsePart && toolUsePart.data && 'toolCode' in toolUsePart.data) {
      this.scheduler.schedule(toolUsePart.data.toolCode);
    }

  }
  
  flushAccumulatedContent() {
    if (this.accumulatedContent === '') {
      return;
    }
    this.eventBus.publish({
        kind: 'message',
        role: 'agent',
        parts: [{ kind: 'text', text: this.accumulatedContent }],
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      });
    this.accumulatedContent = '';
  }
}
