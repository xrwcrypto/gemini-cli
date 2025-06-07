import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Task } from './task.js';
import { CoreToolScheduler, GeminiClient, Config } from '@gemini-code/core';
import { IExecutionEventBus, schema } from '@gemini-code/a2alib';
import { CoderAgentEvent } from './types.js';

vi.mock('@gemini-code/core', async () => {
  const original = await vi.importActual('@gemini-code/core');
  return {
    ...original,
    CoreToolScheduler: vi.fn(),
    GeminiClient: vi.fn(),
    Config: vi.fn(() => ({
      getToolRegistry: vi.fn(),
    })),
  };
});

describe('Task', () => {
  let task: Task;
  let mockEventBus: IExecutionEventBus;
  let mockConfig: Config;

  beforeEach(() => {
    mockEventBus = {
      publish: vi.fn(),
    };
    mockConfig = new Config();
    task = new Task('test-task', 'test-context', mockConfig, mockEventBus);
  });

  it('should initialize with the correct state', () => {
    expect(task.id).toBe('test-task');
    expect(task.contextId).toBe('test-context');
    expect(task.taskState).toBe(schema.TaskState.Submitted);
  });

  it('should publish a state change event', () => {
    task.setTaskStateAndPublishUpdate(
      schema.TaskState.Working,
      CoderAgentEvent.StateChangeEvent,
    );

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'status-update',
        status: expect.objectContaining({
          state: schema.TaskState.Working,
        }),
        metadata: {
          coderAgent: {
            kind: CoderAgentEvent.StateChangeEvent,
          },
        },
      }),
    );
  });
});
