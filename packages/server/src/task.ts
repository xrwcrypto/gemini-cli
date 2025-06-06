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
  Tool,
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

import { PartUnion } from '@google/genai';

type ToolDef = Omit<Tool, 'config'>;

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
  
  constructor(
    id: string,
    contextId: string,
    config: Config,
    eventBus: IExecutionEventBus,
  ) {
    this.id = id;
    this.contextId = contextId;
    this.config = config;
    this.scheduler = this.createScheduler(this.id, contextId);
    this.geminiClient = new GeminiClient(this.config);
    this.pendingToolConfirmationDetails = new Map<string, ToolCallConfirmationDetails>();
    this.taskState = TaskState.Submitted;
    this.accumulatedContent = "";
    this.eventBus = eventBus;
  }

    private createScheduler(
      taskId: string,
      contextId: string,
    ): CoreToolScheduler {
        const scheduler = new CoreToolScheduler({
          toolRegistry: this.config.getToolRegistry(),
          outputUpdateHandler: (toolCallId: string, outputChunk: string) => {
            console.log("Received output chunk for tool call " + toolCallId + ": " + outputChunk)
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
              taskId,
              contextId,
              artifact,
              append: true,
              lastChunk: false,
            };
            this.eventBus.publish(artifactEvent);
          },
          onAllToolCallsComplete: (completedToolCalls: CompletedToolCall[]) => {
            console.log("All tool calls completed", completedToolCalls);
            completedToolCalls.forEach((tc) => {
              const statusMessage: Message = this.toolStatusMessage(tc, taskId, contextId);
  
              const statusEvent: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId,
                contextId,
                status: {
                  state: this.taskState,
                  message: statusMessage,
                  timestamp: new Date().toISOString(),
                },
                final: false,
              };
              this.eventBus.publish(statusEvent);
            });
          },
          onToolCallsUpdate: (toolCalls: ToolCall[]) => {
            console.log("Tool calls updated", toolCalls);
            toolCalls.forEach((tc) => {
              const statusMessage: Message = this.toolStatusMessage(tc, taskId, contextId);
  
              const statusEvent: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId,
                contextId,
                status: {
                  state: this.taskState,
                  message: statusMessage,
                  timestamp: new Date().toISOString(),
                },
                final: false,
              };
              this.eventBus.publish(statusEvent);
            });
          },
        });
        return scheduler;
    }
  private toolStatusMessage(tc: ToolCall, taskId: string, contextId: string) {
    const messageParts: Part[] = [];
    switch (tc.status) {
      case 'awaiting_approval':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            tool: tc.tool as ToolDef,
            status: tc.status,
            confirmationDetails: tc.confirmationDetails
          }
        } as Part);
        break;
      case 'cancelled':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            tool: tc.tool as ToolDef,
            status: tc.status,
          }
        } as Part);
        break;
      case 'error':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            response: tc.response,
            status: tc.status,
          }
        } as Part);
        break;
      case 'executing':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            tool: tc.tool as ToolDef,
            status: tc.status,
          }
        } as Part);
        break;
      case 'scheduled':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            tool: tc.tool as ToolDef,
            status: tc.status,
          }
        } as Part);
        break;
      case 'validating':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            tool: tc.tool as ToolDef,
            status: tc.status,
          }
        } as Part);
        break;
      case 'success':
        messageParts.push({
          kind: 'data', data: {
            request: tc.request,
            response: tc.response,
            tool: tc.tool as ToolDef,
            status: tc.status,
          }
        } as Part);
        break;
    }

    const statusMessage: Message = {
      kind: 'message',
      role: 'agent',
      parts: messageParts,
      messageId: uuidv4(),
      taskId,
      contextId,
    };
    return statusMessage;
  }

  // Change the state and write to the A2A eventBus
  async acceptAgentMessage(event: ServerGeminiStreamEvent, eventBus: IExecutionEventBus): Promise<void> {
    switch (event.type) {
      case GeminiEventType.Content:
        console.log("accumulating agent message")
        this.accumulatedContent += event.value;
        break;
      case GeminiEventType.ToolCallRequest:
        console.log("received tool call request")
        this.flushAccumulatedContent(eventBus);
        this.taskState = schema.TaskState.Working;
        eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
          },
          final: false,
        });
        await this.scheduler.schedule(event.value);
        break;
      case GeminiEventType.ToolCallResponse:
        console.log("received tool call response");
        this.flushAccumulatedContent(eventBus);
        this.taskState = schema.TaskState.Working;
        eventBus.publish({
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
        console.log("received tool call confirmation");
        this.flushAccumulatedContent(eventBus);
        this.taskState = schema.TaskState.Working;
        this.pendingToolConfirmationDetails.set(event.value.request.callId, event.value.details);
        eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
            message: {
              messageId: uuidv4(),
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: "Received tool call confirmation" }],
            },
          },
          final: false,
        })
        break;
      case GeminiEventType.UserCancelled:
        console.log("received user cancelled event");
        this.flushAccumulatedContent(eventBus);
        this.taskState = schema.TaskState.Canceled;
        eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
            message: {
              messageId: uuidv4(),
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: "Task cancelled by user" }],
            }
          },
          final: true,
        });
        break;
      case GeminiEventType.Error:
      default:
        console.error("received error event");
        this.flushAccumulatedContent(eventBus);
        this.taskState = schema.TaskState.Failed;
        eventBus.publish({
          kind: 'status-update',
          taskId: this.id,
          contextId: this.contextId,
          status: {
            state: this.taskState,
            message: {
              messageId: uuidv4(),
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: "Task failed" }],
            }
          },
          final: true,
        });
        break;
    }
  }

  acceptUserMessage(requestContext: RequestContext, aborted: AbortSignal): AsyncGenerator<ServerGeminiStreamEvent> {
    console.log(requestContext);

    const userMessage = requestContext.userMessage;
    // gather all text parts and send to the agent.
    let parts: PartUnion[] = [];
    for (const part of userMessage.parts) {
      switch (part.kind) {
        case 'text':
          parts.push({ text: part.text } as PartUnion);
          break;
      }
    }

    return this.geminiClient.sendMessageStream(parts, aborted);

    // let toolCallRequestInfo: ToolCallRequestInfo[] = []; 
    // for (const part of userMessage.parts) {
    //   // Assume all data parts are tool call confirmation responses.
    //   if (part.kind == "data") {
    //     toolCallRequestInfo.push({
    //       name: part.data["name"],
    //       args: part.data["args"],
    //       callId: part.data["callId"],
    //     } as ToolCallRequestInfo);
    //   }
    // }

    // // if this is in pending tool confirmation details, call callback
    // //this.pendingToolConfirmationDetails.get("tool call ID")?.onConfirm(ToolConfirmationOutcome.ProceedOnce);

    // this.scheduler.schedule(toolCallRequestInfo);
  }

  // handleFirstUserMessage(requestContext: RequestContext, aborted: AbortSignal): AsyncGenerator<ServerGeminiStreamEvent> {
  //   const userMessage = requestContext.userMessage;
  //   return this.geminiClient.sendMessageStream(userMessage.parts, aborted);
  // }
  
  flushAccumulatedContent(eventBus: IExecutionEventBus): boolean {
    if (this.accumulatedContent === '') {
      return false;
    }
    eventBus.publish({
        kind: 'message',
        role: 'agent',
        parts: [{ kind: 'text', text: this.accumulatedContent }],
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      });
    this.accumulatedContent = '';
    return true;
  }
}
