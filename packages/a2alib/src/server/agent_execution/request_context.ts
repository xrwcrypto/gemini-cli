/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message, Task } from '../../schema.js';

export class RequestContext {
  readonly userMessage: Message;
  private cancellationChecker: () => boolean;
  readonly task?: Task;
  readonly referenceTasks?: Task[];

  constructor(
    userMessage: Message,
    cancellationChecker: () => boolean,
    task?: Task,
    referenceTasks?: Task[],
  ) {
    this.userMessage = userMessage;
    this.cancellationChecker = cancellationChecker;
    this.task = task;
    this.referenceTasks = referenceTasks;
  }

  /**
   * Checks if the current task associated with this context needs to be cancelled.
   */
  isCancelled(): boolean {
    return this.cancellationChecker();
  }
}
