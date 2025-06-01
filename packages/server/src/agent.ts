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
} from '@gemini-code/core';
import { v4 as uuidv4 } from 'uuid';

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

  constructor() {
    // Basic configuration for the server
    // In a production environment, these would come from a more robust config system
    const configParams: ConfigParameters = {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro-preview-05-06', // Or your preferred model
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
    };
    const config = createServerConfig(configParams);
    this.geminiClient = new GeminiClient(config);
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
        clearInterval(cancellationCheckInterval);
      }
    }, 500); // Check every 500ms

    try {
      const chat = await this.geminiClient.startChat();
      const stream = this.geminiClient.sendMessageStream(
        chat,
        [{ text: prompt }],
        abortSignal,
      );

      for await (const event of stream) {
        if (abortSignal.aborted) {
          // Event stream might have already yielded UserCancelled, but good to check
          break;
        }

        switch (event.type) {
          case GeminiEventType.Content:
            eventBus.publish({
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: event.value }],
              messageId: uuidv4(),
              taskId,
              contextId,
            });
            break;
          case GeminiEventType.ToolCallRequest:
            console.log('Tool call request received:', event.value);
            // Publish an InputRequired status update
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: schema.TaskState.InputRequired,
                message: {
                  kind: 'message',
                  role: 'agent',
                  messageId: uuidv4(),
                  parts: [
                    {
                      kind: 'data',
                      data: {
                        toolCallId: event.value.callId,
                        name: event.value.name,
                        args: event.value.args,
                      },
                    },
                  ],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false, // Expecting a tool response
            });
            break;
          case GeminiEventType.ToolCallResponse:
            console.log('Tool call response received:', event.value);
            // Publish a message with the tool response
            eventBus.publish({
              kind: 'message',
              role: 'user', // Representing tool output as if from the user
              messageId: uuidv4(),
              parts: [
                {
                  kind: 'data',
                  data: {
                    toolCallId: event.value.callId,
                    // For simplicity, stringifying responseParts. Ideally, map to structured data if needed.
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
            console.log('Tool call confirmation received:', event.value);
            // Publish a message indicating tool confirmation
            eventBus.publish({
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [
                {
                  kind: 'text',
                  text: `Tool call ${event.value.request.callId} (${event.value.request.name}) confirmed. Details: ${JSON.stringify(event.value.details)}`,
                },
              ],
              taskId,
              contextId,
            });
            break;
          case GeminiEventType.UserCancelled:
            eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: { state: schema.TaskState.Canceled },
              final: true,
            });
            // No need to clear interval here, it's cleared by the abort logic
            return; // Exit early as task is cancelled
          case GeminiEventType.Error:
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
            clearInterval(cancellationCheckInterval);
            return; // Exit early on error
          default: {
            // Exhaustive check for unhandled event types
            const _exhaustiveCheck: never = event;
            console.warn('Unhandled stream event type:', _exhaustiveCheck);
            break;
          }
        }
      }

      if (!abortSignal.aborted) {
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: { state: schema.TaskState.Completed },
          final: true,
        });
      }
    } catch (error) {
      if (!abortSignal.aborted) {
        // Avoid double-reporting if already cancelled
        console.error('Error executing agent:', error);
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: schema.TaskState.Failed,
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                {
                  kind: 'text',
                  text:
                    error instanceof Error ? error.message : 'Unknown error',
                },
              ],
              messageId: uuidv4(),
              taskId,
              contextId,
            },
          },
          final: true,
        });
      }
    } finally {
      clearInterval(cancellationCheckInterval);
    }
  }
}

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new CoderAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    coderAgentCard,
    taskStore,
    agentExecutor,
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
