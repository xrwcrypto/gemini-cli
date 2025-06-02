/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
// For generating unique IDs (currently unused)
// import { v4 as uuidv4 } from 'uuid';

import {
  InMemoryTaskStore,
  TaskStore,
  A2AExpressApp,
  AgentExecutor,
  RequestContext,
  IExecutionEventBus,
  DefaultRequestHandler,
  schema,
} from '@gemini-code/a2alib'; // Import server components
import {
  GeminiClient,
  createServerConfig,
  type ConfigParameters,
  GeminiEventType,
  Config,
  ToolCallRequestInfo,
  loadEnvironment,
  type GeminiChat,
} from '@gemini-code/core';
import { v4 as uuidv4 } from 'uuid';
import { TaskToolSchedulerManager } from './task_tool_scheduler_manager.js';

const coderAgentCard: schema.AgentCard = {
  name: 'Coder Agent',
  description:
    'An agent that generates code based on natural language instructions and streams file outputs.',
  url: 'http://localhost:41242/', // Adjusted port and base URL
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '0.0.2', // Incremented version
  capabilities: {
    streaming: true, // Agent streams artifact updates
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'file'], // 'file' implies artifacts
  skills: [
    {
      id: 'code_generation',
      name: 'Code Generation',
      description:
        'Generates code snippets or complete files based on user requests, streaming the results.',
      tags: ['code', 'development', 'programming'],
      examples: [
        'Write a python function to calculate fibonacci numbers.',
        'Create an HTML file with a basic button that alerts "Hello!" when clicked.',
      ],
      inputModes: ['text'],
      outputModes: ['text', 'file'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

/**
 * CoderAgentExecutor implements the agent's core logic for code generation.
 */
class CoderAgentExecutor implements AgentExecutor {
  private geminiClient: GeminiClient;
  private config: Config;
  private taskToolSchedulerManager: TaskToolSchedulerManager;
  private chatSessions: Map<string, GeminiChat> = new Map();

  constructor(
    config: Config,
    taskToolSchedulerManager: TaskToolSchedulerManager,
  ) {
    this.config = config;
    this.geminiClient = new GeminiClient(this.config);
    this.taskToolSchedulerManager = taskToolSchedulerManager;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: IExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    const taskId = existingTask?.id || uuidv4();
    const contextId =
      userMessage.contextId || existingTask?.contextId || uuidv4();

    console.log(
      `[CoderAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`,
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: schema.Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: schema.TaskState.Submitted,
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
        artifacts: [], // Initialize artifacts array
      };
      eventBus.publish(initialTask);

      // Also publish an initial non-final status update
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: initialTask.status, // Use the same status object
        final: false, // Initial submission is not final
      });
    }

    const promptPart = userMessage?.parts?.find(
      (part): part is schema.TextPart => part.kind === 'text',
    );
    const prompt = promptPart?.text;

    if (!prompt) {
      console.error('No text prompt found in requestContext.userMessage.parts');
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: schema.TaskState.Failed,
          message: {
            kind: 'message',
            role: 'agent',
            parts: [{ kind: 'text', text: 'No text prompt provided.' }],
            messageId: uuidv4(),
            taskId,
            contextId,
          },
        },
        final: true,
      });
      return;
    }

    const abortController = new AbortController();
    const abortSignal = abortController.signal;

    // Polling for cancellation
    const cancellationCheckInterval = setInterval(() => {
      if (requestContext.isCancelled()) {
        abortController.abort();
        // Also inform the taskToolSchedulerManager if a task is being cancelled externally
        this.taskToolSchedulerManager.cancelTask(
          taskId,
          contextId,
          eventBus,
          'Cancelled due to external request',
        );
        clearInterval(cancellationCheckInterval);
      }
    }, 500); // Check every 500ms

    try {
      let chat = this.chatSessions.get(taskId);
      if (!chat) {
        chat = await this.geminiClient.startChat();
        this.chatSessions.set(taskId, chat);
      }

      const stream = this.geminiClient.sendMessageStream(
        chat, // Use the retrieved or new chat session
        [{ text: prompt }],
        abortSignal,
      );

      let accumulatedContent = '';

      for await (const event of stream) {
        if (abortSignal.aborted) {
          // Event stream might have already yielded UserCancelled, but good to check
          break;
        }

        switch (event.type) {
          case GeminiEventType.Content:
            accumulatedContent += event.value;
            break;
          case GeminiEventType.ToolCallRequest:
            if (accumulatedContent) {
              eventBus.publish({
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text: accumulatedContent }],
                messageId: uuidv4(),
                taskId,
                contextId,
              });
              accumulatedContent = ''; // Reset after publishing
            }
            console.log(
              '[CoderAgentExecutor] Tool call request received:',
              event.value,
            );
            this.taskToolSchedulerManager.scheduleToolCalls(
              taskId,
              contextId,
              event.value as ToolCallRequestInfo | ToolCallRequestInfo[], // Cast to expected type
              eventBus,
            );
            // The TaskToolSchedulerManager will now emit appropriate status updates (e.g., Submitted, Working)
            // It will also emit InputRequired if a tool needs confirmation.
            break;
          case GeminiEventType.ToolCallResponse:
            // This event type is usually for when the GeminiClient itself handles the tool call response.
            // Since we are scheduling tools externally via TaskToolSchedulerManager, this path might be less common
            // unless GeminiClient is also configured with a CoreToolScheduler that can respond directly.
            // For now, we'll log it. The TaskToolSchedulerManager will be responsible for sending
            // the actual tool results back to the Gemini model via subsequent sendMessageStream calls if needed,
            // or by providing the results in the history for the next turn.
            console.log(
              '[CoderAgentExecutor] Tool call response received by GeminiClient:',
              event.value,
            );
            eventBus.publish({
              kind: 'message',
              role: 'user', // Representing tool output as if from the user to the model
              messageId: uuidv4(),
              parts: [
                {
                  kind: 'data',
                  data: {
                    toolCallId: event.value.callId,
                    response: JSON.stringify(event.value.responseParts),
                    error: event.value.error?.message,
                    resultDisplay: event.value.resultDisplay,
                  },
                },
              ],
              taskId,
              contextId,
            });
            break;
          case GeminiEventType.ToolCallConfirmation:
            // This event is informational, indicating a tool call was confirmed by the CoreToolScheduler within GeminiClient.
            // Our TaskToolSchedulerManager handles its own confirmations if a tool requires it (awaiting_approval state).
            console.log(
              '[CoderAgentExecutor] Tool call confirmation received by GeminiClient:',
              event.value,
            );
            eventBus.publish({
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [
                {
                  kind: 'text',
                  text: `GeminiClient confirmed tool call ${event.value.request.callId} (${event.value.request.name}). Details: ${JSON.stringify(event.value.details)}`,
                },
              ],
              taskId,
              contextId,
            });
            break;
          case GeminiEventType.UserCancelled:
            if (accumulatedContent) {
              // Publish any remaining content before cancelling
              eventBus.publish({
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text: accumulatedContent }],
                messageId: uuidv4(),
                taskId,
                contextId,
              });
              accumulatedContent = '';
            }
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: { state: schema.TaskState.Canceled },
              final: true,
            });
            this.taskToolSchedulerManager.cancelTask(
              taskId,
              contextId,
              eventBus,
              'Cancelled by user via GeminiClient event',
            );
            return; // Exit early as task is cancelled
          case GeminiEventType.Error:
            if (accumulatedContent) {
              // Publish any remaining content before erroring
              eventBus.publish({
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text: accumulatedContent }],
                messageId: uuidv4(),
                taskId,
                contextId,
              });
              accumulatedContent = '';
            }
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: schema.TaskState.Failed,
                message: {
                  kind: 'message',
                  role: 'agent',
                  parts: [{ kind: 'text', text: event.value.message }],
                  messageId: uuidv4(),
                  taskId,
                  contextId,
                },
              },
              final: true,
            });
            this.taskToolSchedulerManager.cancelTask(
              taskId,
              contextId,
              eventBus,
              `Failed due to GeminiClient error: ${event.value.message}`,
            );
            clearInterval(cancellationCheckInterval);
            return; // Exit early on error
          default: {
            // Exhaustive check for unhandled event types
            const _exhaustiveCheck: never = event;
            console.warn(
              '[CoderAgentExecutor] Unhandled stream event type:',
              _exhaustiveCheck,
            );
            break;
          }
        }
      }

      if (!abortSignal.aborted && accumulatedContent) {
        // If the loop finishes, wasn't aborted, and there's remaining content,
        // publish it as the final message for this turn.
        eventBus.publish({
          kind: 'message',
          role: 'agent',
          parts: [{ kind: 'text', text: accumulatedContent }],
          messageId: uuidv4(),
          taskId,
          contextId,
        });
        accumulatedContent = ''; // Clear after publishing
      }

      if (!abortSignal.aborted) {
        // If the loop finishes and wasn't aborted, it implies the model finished its turn.
        // The actual 'Completed' state for the task (after tools) is handled by TaskToolSchedulerManager.
        // We might send an interim 'agent processing complete' or just let TaskToolSchedulerManager drive the final state.
        console.log(
          '[CoderAgentExecutor] Model finished generating content/tool calls for this turn.',
        );
        // If no tool calls were made and content was generated, this might be the end of the task.
        // However, TaskToolSchedulerManager is designed to send the final 'Completed' or 'Failed' event.
        // To prevent premature 'Completed' if tools are pending, we might not send a 'Completed' here.
        // Let TaskToolSchedulerManager's onAllToolCallsComplete be the definitive source of truth for task completion.
      }
    } catch (error) {
      if (!abortSignal.aborted) {
        console.error('[CoderAgentExecutor] Error executing agent:', error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown error during agent execution';
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: schema.TaskState.Failed,
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: errorMessage }],
              messageId: uuidv4(),
              taskId,
              contextId,
            },
          },
          final: true,
        });
        this.taskToolSchedulerManager.cancelTask(
          taskId,
          contextId,
          eventBus,
          `Failed due to agent error: ${errorMessage}`,
        );
      }
    } finally {
      clearInterval(cancellationCheckInterval);
    }
  }
}

async function main() {
  loadEnvironment();
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  // Basic configuration for the server
  // In a production environment, these would come from a more robust config system
  const configParams: ConfigParameters = {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-pro-preview-05-06', // Updated model
    sandbox: false, // Sandbox might not be relevant for a server-side agent
    targetDir: process.cwd(), // Or a specific directory the agent operates on
    debugMode: process.env.DEBUG === 'true' || false,
    question: '', // Not used in server mode directly like CLI
    fullContext: false, // Server might have different context needs
    userAgent: `GeminiA2AServer/0.1.0 Node.js/${process.version}`, // Basic user agent
    userMemory: '', // Server might manage memory differently or not at all initially
    geminiMdFileCount: 0,
    // Ensure Vertex AI config is handled if necessary
    vertexai:
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ? true : undefined,
    // tool related configs are omitted for now, assuming server won't use CLI's tool discovery
    // but coreTools can be specified if needed, e.g., coreTools: ['ReadFileTool', 'ShellTool']
  };
  const config = createServerConfig(configParams);

  // Create TaskToolSchedulerManager
  const taskToolSchedulerManager = new TaskToolSchedulerManager(config);

  // Pass TaskToolSchedulerManager to CoderAgentExecutor
  const agentExecutor: AgentExecutor = new CoderAgentExecutor(
    config,
    taskToolSchedulerManager,
  );

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    coderAgentCard,
    taskStore,
    agentExecutor,
    // true // waitForAgentOnTaskCancellation (optional param)
  );

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express(), '');

  // 5. Start the server
  const PORT = process.env.CODER_AGENT_PORT || 41242; // Different port for coder agent
  expressApp.listen(PORT, () => {
    console.log(
      `[CoderAgent] Server using new framework started on http://localhost:${PORT}`,
    );
    console.log(
      `[CoderAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`,
    );
    console.log('[CoderAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);
