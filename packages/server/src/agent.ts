/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';

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
  // GeminiClient, // Not used directly in this file after changes
  createServerConfig,
  type ConfigParameters,
  // GeminiEventType, // Not used directly in this file after changes
  Config,
  // ToolConfirmationOutcome, // Not used directly in this file after changes
  loadEnvironment,
  ApprovalMode,
} from '@gemini-code/core';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';
import { CoderAgentEvent } from './types.js';
// import { TaskToolSchedulerManager } from './task_tool_scheduler_manager.js'; // Not used for now
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
      outputModes: ['text'],
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

  constructor(config: Config) {
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

    logger.info(
      `[CoderAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`,
    );

    let task: Task;

    if (existingTask && this.tasks.has(taskId)) {
      task = this.tasks.get(taskId)!;
      task.eventBus = eventBus; // Update eventBus in case it changed (e.g. new SSE connection)
    } else if (!existingTask) {
      task = new Task(taskId, contextId, this.baseConfig, eventBus);
      this.tasks.set(taskId, task);
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
    } else {
      // Got a task ID for an existing task, but we don't have it in our map.
      logger.error(
        `[CoderAgentExecutor] Received existing task ID ${taskId} but task not found in memory.`,
      );
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
                text: 'Internal error: Task state lost.',
              },
            ],
            messageId: uuidv4(),
            taskId,
            contextId,
          },
        },
        final: true,
        metadata: {
          coderAgent: {
            kind: CoderAgentEvent.StateChangeEvent,
          },
        },
      });
      return;
    }

    const abortController = new AbortController();
    const abortSignal = abortController.signal;

    const cancellationCheckInterval = setInterval(() => {
      if (requestContext.isCancelled()) {
        logger.info(
          `[CoderAgentExecutor] RequestContext cancelled for task ${taskId}. Aborting.`,
        );
        abortController.abort();
        task.cancelPendingTools('RequestContext cancelled');
        clearInterval(cancellationCheckInterval);
      }
    }, 500);

    try {
      logger.info(`[CoderAgentExecutor] Task ${taskId}: Processing user turn.`);
      const agentEvents = task.acceptUserMessage(requestContext, abortSignal);

      logger.info(
        `[CoderAgentExecutor] Task ${taskId}: Processing agent turn (LLM stream).`,
      );
      for await (const event of agentEvents) {
        if (abortSignal.aborted) {
          logger.info(
            `[CoderAgentExecutor] Task ${taskId}: Aborted during agent event stream.`,
          );
          task.flushAccumulatedContent();
          throw new Error('Task aborted during agent event stream');
        }
        await task.acceptAgentMessage(event);
      }
      task.flushAccumulatedContent();

      if (abortSignal.aborted) {
        logger.info(
          `[CoderAgentExecutor] Task ${taskId}: Aborted after agent event stream.`,
        );
        throw new Error('Task aborted after agent event stream');
      }

      logger.info(
        `[CoderAgentExecutor] Task ${taskId}: Waiting for pending tools if any.`,
      );
      await task.waitForPendingTools();
      logger.info(
        `[CoderAgentExecutor] Task ${taskId}: All pending tools completed or none were pending.`,
      );

      if (abortSignal.aborted) {
        throw new Error('Task aborted after waiting for tools');
      }

      if (
        task.taskState !== schema.TaskState.InputRequired &&
        task.taskState !== schema.TaskState.Canceled &&
        task.taskState !== schema.TaskState.Failed
      ) {
        task.setTaskStateAndPublishUpdate(
          schema.TaskState.InputRequired,
          CoderAgentEvent.StateChangeEvent,
          undefined,
          undefined,
          true,
        );
      }
    } catch (error) {
      clearInterval(cancellationCheckInterval); // Clear interval early on error
      task.cancelPendingTools(
        error instanceof Error ? error.message : 'Agent execution error',
      );

      if (
        abortSignal.aborted &&
        (error as Error)?.message?.includes('aborted')
      ) {
        if (
          task.taskState !== schema.TaskState.Canceled &&
          task.taskState !== schema.TaskState.Failed
        ) {
          task.setTaskStateAndPublishUpdate(
            schema.TaskState.Canceled,
            CoderAgentEvent.StateChangeEvent,
            'Task execution was cancelled.',
            undefined,
            true,
          );
        }
      } else {
        logger.error(
          '[CoderAgentExecutor] Error executing agent for task',
          taskId,
          error,
        );
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown error during agent execution';
        if (task.taskState !== schema.TaskState.Failed) {
          task.setTaskStateAndPublishUpdate(
            schema.TaskState.Failed,
            CoderAgentEvent.StateChangeEvent,
            errorMessage,
            undefined,
            true,
          );
        }
      }
    } finally {
      clearInterval(cancellationCheckInterval);
      // Note: Do not remove the task from this.tasks map here.
      // The task object holds history and state that might be needed for subsequent interactions
      // or if the A2A client queries the task status later.
      // Task cleanup/eviction would be a separate mechanism if needed (e.g., based on TTL or memory pressure).
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
    vertexai:
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ? true : undefined,
    approvalMode:
      process.env.GEMINI_YOLO_MODE === 'true'
        ? ApprovalMode.YOLO
        : ApprovalMode.DEFAULT,
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

  const PORT = process.env.CODER_AGENT_PORT || 41242;
  expressApp.listen(PORT, () => {
    logger.info(
      `[CoreAgent] Server using new framework started on http://localhost:${PORT}`,
    );
    logger.info(
      `[CoreAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`,
    );
    logger.info('[CoreAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(logger.error);