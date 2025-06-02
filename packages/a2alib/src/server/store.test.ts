/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTaskStore, TaskAndHistory } from './store.js';
import * as schema from '../schema.js';

describe('InMemoryTaskStore', () => {
  it('should save and load a task', async () => {
    const store = new InMemoryTaskStore();
    const taskData: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
          messageId: 'msg1',
          kind: 'message',
        },
      ],
    };

    await store.save(taskData);
    const loadedData = await store.load('task1');

    expect(loadedData).toEqual(taskData);
  });

  it('should return null if task not found', async () => {
    const store = new InMemoryTaskStore();
    const loadedData = await store.load('nonexistent-task');
    expect(loadedData).toBeNull();
  });

  it('should overwrite an existing task when saving with the same ID', async () => {
    const store = new InMemoryTaskStore();
    const initialTaskData: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'First message' }],
          messageId: 'msg1',
          kind: 'message',
        },
      ],
    };
    const updatedTaskData: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Completed },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Second message' }],
          messageId: 'msg2',
          kind: 'message',
        },
      ],
    };

    await store.save(initialTaskData);
    await store.save(updatedTaskData);
    const loadedData = await store.load('task1');

    expect(loadedData).toEqual(updatedTaskData);
  });

  it('should return a copy of the task and history, not the original objects', async () => {
    const store = new InMemoryTaskStore();
    const taskData: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
          messageId: 'msg1',
          kind: 'message',
        },
      ],
    };

    await store.save(taskData);
    const loadedData = await store.load('task1');

    // Modify the original data
    taskData.task.status.state = schema.TaskState.Working;
    taskData.history.push({
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hi there' }],
      messageId: 'msg2',
      kind: 'message',
    });

    // Loaded data should not be affected
    expect(loadedData?.task.status.state).toBe(schema.TaskState.Submitted);
    expect(loadedData?.history.length).toBe(1);
    expect(
      loadedData?.history[0].parts[0].kind === 'text' &&
        loadedData?.history[0].parts[0].text,
    ).toBe('Hello');
  });

  it('loading a task should return a copy, modifying loaded data should not affect stored data', async () => {
    const store = new InMemoryTaskStore();
    const taskData: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
          messageId: 'msg1',
          kind: 'message',
        },
      ],
    };

    await store.save(taskData);
    const loadedData1 = await store.load('task1');

    if (loadedData1) {
      loadedData1.task.status.state = schema.TaskState.Working;
      loadedData1.history.push({
        role: 'agent',
        parts: [{ kind: 'text', text: 'Added in loadedData1' }],
        messageId: 'msg2',
        kind: 'message',
      });
    }

    const loadedData2 = await store.load('task1');
    expect(loadedData2?.task.status.state).toBe(schema.TaskState.Submitted);
    expect(loadedData2?.history.length).toBe(1);
  });

  it('should handle multiple tasks', async () => {
    const store = new InMemoryTaskStore();
    const taskData1: TaskAndHistory = {
      task: {
        id: 'task1',
        contextId: 'ctx1',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Message for task 1' }],
          messageId: 'msg1',
          kind: 'message',
        },
      ],
    };
    const taskData2: TaskAndHistory = {
      task: {
        id: 'task2',
        contextId: 'ctx2',
        status: { state: schema.TaskState.Submitted },
        kind: 'task',
      },
      history: [
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'Message for task 2' }],
          messageId: 'msg2',
          kind: 'message',
        },
      ],
    };

    await store.save(taskData1);
    await store.save(taskData2);

    const loadedTask1 = await store.load('task1');
    const loadedTask2 = await store.load('task2');

    expect(loadedTask1).toEqual(taskData1);
    expect(loadedTask2).toEqual(taskData2);
  });
});
