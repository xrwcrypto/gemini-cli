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
  ToolConfirmationOutcome,
  loadEnvironment,
} from '@gemini-code/core';
import { v4 as uuidv4 } from 'uuid';
import { TaskToolSchedulerManager } from './task_tool_scheduler_manager.js';
import { Task } from './task.js';

const coderAgentCard: schema.AgentCard = {
  name: 'Gemini SDLC Agent',
  description:
    'An agent that generates code based on natural language instructions and streams file outputs.',
  url: 'http://localhost:41242/',
  provider: {
    organization: 'Google',
    url: 'https://google.com',
  },
  version: '0.0.2', // Incremented version
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
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
  private baseConfig: Config;
  private tasks: Map<string, Task> = new Map();

  constructor(
    config: Config,
  ) {
    this.baseConfig = config;
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

    // Got a task that we weren't expecting.
    if (existingTask && !this.tasks.has(taskId)) {
      eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: { state: schema.TaskState.Failed },
          final: true,
        });
      return;
    }

    if (!existingTask) {
      this.tasks.set(
        taskId,
        new Task(taskId, contextId, this.baseConfig)
      );
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: schema.TaskState.Submitted,
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
      });
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
      const task = this.tasks.get(taskId)!;
      // Do a turn: accept user input, then respond.
      console.log("processing user turn");
      let agentEvents = task.acceptUserMessage(requestContext, abortSignal);
      console.log("processing agent turn");
      for await (const event of agentEvents) {
        task.acceptAgentMessage(event, eventBus);
      }
      // If we flush content here, it means that we completed a turn ending with the agent speaking, and we
      // need to tell the client that it's their turn.
      if (task.flushAccumulatedContent(eventBus)) {
        eventBus.publish({
          kind: "status-update",
          taskId: taskId,
          contextId: contextId,
          status: { state: schema.TaskState.InputRequired },
          final: true,
        })
      }
      console.log("agent turn completed")
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
      }
    } finally {
      clearInterval(cancellationCheckInterval);
    }
  }
}

async function main() {
  loadEnvironment();
  const taskStore: TaskStore = new InMemoryTaskStore();
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
  const agentExecutor: AgentExecutor = new CoderAgentExecutor(config);

  const requestHandler = new DefaultRequestHandler(
    coderAgentCard,
    taskStore,
    agentExecutor,
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express(), '');

  const PORT = process.env.CODER_AGENT_PORT || 41242; // Different port for coder agent
  expressApp.listen(PORT, () => {
    console.log(
      `[CoreAgent] Server using new framework started on http://localhost:${PORT}`,
    );
    console.log(
      `[CoreAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`,
    );
    console.log('[CoreAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);