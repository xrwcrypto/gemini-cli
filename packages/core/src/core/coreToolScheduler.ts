/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ToolConfirmationOutcome,
  Tool,
  ToolCallConfirmationDetails,
  ToolResult,
  ToolRegistry,
  ApprovalMode,
  EditorType,
  Config,
  logToolCall,
  ToolCallEvent,
  GeminiClient,
} from '../index.js';
import { Part, PartListUnion } from '@google/genai';
import { getResponseTextFromParts } from '../utils/generateContentResponseUtilities.js';
import {
  isModifiableTool,
  ModifyContext,
  modifyWithEditor,
} from '../tools/modifiable-tool.js';
import { summarizeText } from '../utils/promptSummarizer.js';

export type ValidatingToolCall = {
  status: 'validating';
  request: ToolCallRequestInfo;
  tool: Tool;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ScheduledToolCall = {
  status: 'scheduled';
  request: ToolCallRequestInfo;
  tool: Tool;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ErroredToolCall = {
  status: 'error';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type SuccessfulToolCall = {
  status: 'success';
  request: ToolCallRequestInfo;
  tool: Tool;
  response: ToolCallResponseInfo;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: Tool;
  liveOutput?: string;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type CancelledToolCall = {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool: Tool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type WaitingToolCall = {
  status: 'awaiting_approval';
  request: ToolCallRequestInfo;
  tool: Tool;
  confirmationDetails: ToolCallConfirmationDetails;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type Status = ToolCall['status'];

export type ToolCall =
  | ValidatingToolCall
  | ScheduledToolCall
  | ErroredToolCall
  | SuccessfulToolCall
  | ExecutingToolCall
  | CancelledToolCall
  | WaitingToolCall;

export type CompletedToolCall =
  | SuccessfulToolCall
  | CancelledToolCall
  | ErroredToolCall;

export type ConfirmHandler = (
  toolCall: WaitingToolCall,
) => Promise<ToolConfirmationOutcome>;

export type OutputUpdateHandler = (
  toolCallId: string,
  outputChunk: string,
) => void;

export type AllToolCallsCompleteHandler = (
  completedToolCalls: CompletedToolCall[],
) => void;

export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void;

/**
 * Formats tool output for a Gemini FunctionResponse.
 */
function createFunctionResponsePart(
  callId: string,
  toolName: string,
  output: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
    },
  };
}

export async function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  geminiClient: GeminiClient,
  abortSignal: AbortSignal,
): Promise<PartListUnion> {
  console.log("Converting to function response");
  const contentToProcess =
    Array.isArray(llmContent) && llmContent.length === 1
      ? llmContent[0]
      : llmContent;

  console.log(typeof contentToProcess);
  if (typeof contentToProcess === 'string' ) {
    const summarizedContent = await summarizeText(contentToProcess, geminiClient, abortSignal)
    return createFunctionResponsePart(callId, toolName, summarizedContent?.summary || '');
  }

  if (Array.isArray(contentToProcess)) {
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      'Tool execution succeeded.',
    );
    return [functionResponse, ...contentToProcess];
  }

  // After this point, contentToProcess is a single Part object.
  if (contentToProcess.functionResponse) {
    if (contentToProcess.functionResponse.response?.content) {
      const stringifiedOutput =
        getResponseTextFromParts(
          contentToProcess.functionResponse.response.content as Part[],
        ) || '';
      return createFunctionResponsePart(callId, toolName, stringifiedOutput);
    }
    // It's a functionResponse that we should pass through as is.
    return contentToProcess;
  }

  if (contentToProcess.inlineData || contentToProcess.fileData) {
    const mimeType =
      contentToProcess.inlineData?.mimeType ||
      contentToProcess.fileData?.mimeType ||
      'unknown';
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      `Binary content of type ${mimeType} was processed.`,
    );
    return [functionResponse, contentToProcess];
  }

  if (contentToProcess.text !== undefined) {
    return createFunctionResponsePart(callId, toolName, contentToProcess.text);
  }

  // Default case for other kinds of parts.
  return createFunctionResponsePart(
    callId,
    toolName,
    'Tool execution succeeded.',
  );
}

const createErrorResponse = async (
  request: ToolCallRequestInfo,
  error: Error,
  geminiClient?: GeminiClient,
  abortSignal?: AbortSignal,
): Promise<ToolCallResponseInfo> => {
  const summarizedContent =
    geminiClient && abortSignal
      ? await summarizeText(error.message, geminiClient, abortSignal, length=1000)
      : null;

  return {
    callId: request.callId,
    error,
    responseParts: {
      functionResponse: {
        id: request.callId,
        name: request.name,
        response: { error: summarizedContent?.summary || error.message },
      },
    },
    resultDisplay: summarizedContent?.summary || error.message,
  };
};

interface CoreToolSchedulerOptions {
  toolRegistry: Promise<ToolRegistry>;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  approvalMode?: ApprovalMode;
  getPreferredEditor: () => EditorType | undefined;
  config: Config;
}

export class CoreToolScheduler {
  private toolRegistry: Promise<ToolRegistry>;
  private toolCalls: ToolCall[] = [];
  private outputUpdateHandler?: OutputUpdateHandler;
  private onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  private onToolCallsUpdate?: ToolCallsUpdateHandler;
  private approvalMode: ApprovalMode;
  private getPreferredEditor: () => EditorType | undefined;
  private config: Config;

  constructor(options: CoreToolSchedulerOptions) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry;
    this.outputUpdateHandler = options.outputUpdateHandler;
    this.onAllToolCallsComplete = options.onAllToolCallsComplete;
    this.onToolCallsUpdate = options.onToolCallsUpdate;
    this.approvalMode = options.approvalMode ?? ApprovalMode.DEFAULT;
    this.getPreferredEditor = options.getPreferredEditor;
  }

  private setStatusInternal(
    targetCallId: string,
    status: 'success',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'awaiting_approval',
    confirmationDetails: ToolCallConfirmationDetails,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'error',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'cancelled',
    reason: string,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'executing' | 'scheduled' | 'validating',
  ): void;
  private setStatusInternal(
    targetCallId: string,
    newStatus: Status,
    auxiliaryData?: unknown,
  ): void {
    this.toolCalls = this.toolCalls.map((currentCall) => {
      if (
        currentCall.request.callId !== targetCallId ||
        currentCall.status === 'success' ||
        currentCall.status === 'error' ||
        currentCall.status === 'cancelled'
      ) {
        return currentCall;
      }

      // currentCall is a non-terminal state here and should have startTime and tool.
      const existingStartTime = currentCall.startTime;
      const toolInstance = (
        currentCall as
          | ValidatingToolCall
          | ScheduledToolCall
          | ExecutingToolCall
          | WaitingToolCall
      ).tool;

      const outcome = (
        currentCall as
          | ValidatingToolCall
          | ScheduledToolCall
          | ExecutingToolCall
          | WaitingToolCall
      ).outcome;

      switch (newStatus) {
        case 'success': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'success',
            response: auxiliaryData as ToolCallResponseInfo,
            durationMs,
            outcome,
          } as SuccessfulToolCall;
        }
        case 'error': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            status: 'error',
            response: auxiliaryData as ToolCallResponseInfo,
            durationMs,
            outcome,
          } as ErroredToolCall;
        }
        case 'awaiting_approval':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'awaiting_approval',
            confirmationDetails: auxiliaryData as ToolCallConfirmationDetails,
            startTime: existingStartTime,
            outcome,
          } as WaitingToolCall;
        case 'scheduled':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'scheduled',
            startTime: existingStartTime,
            outcome,
          } as ScheduledToolCall;
        case 'cancelled': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'cancelled',
            response: {
              callId: currentCall.request.callId,
              responseParts: {
                functionResponse: {
                  id: currentCall.request.callId,
                  name: currentCall.request.name,
                  response: {
                    error: `[Operation Cancelled] Reason: ${auxiliaryData}`,
                  },
                },
              },
              resultDisplay: undefined,
              error: undefined,
            },
            durationMs,
            outcome,
          } as CancelledToolCall;
        }
        case 'validating':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'validating',
            startTime: existingStartTime,
            outcome,
          } as ValidatingToolCall;
        case 'executing':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'executing',
            startTime: existingStartTime,
            outcome,
          } as ExecutingToolCall;
        default: {
          const exhaustiveCheck: never = newStatus;
          return exhaustiveCheck;
        }
      }
    });
    this.notifyToolCallsUpdate();
    this.checkAndNotifyCompletion();
  }

  private setArgsInternal(targetCallId: string, args: unknown): void {
    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== targetCallId) return call;
      return {
        ...call,
        request: { ...call.request, args: args as Record<string, unknown> },
      };
    });
  }

  private isRunning(): boolean {
    return this.toolCalls.some(
      (call) =>
        call.status === 'executing' || call.status === 'awaiting_approval',
    );
  }

  async schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    if (this.isRunning()) {
      throw new Error(
        'Cannot schedule new tool calls while other tool calls are actively running (executing or awaiting approval).',
      );
    }
    const requestsToProcess = Array.isArray(request) ? request : [request];
    const toolRegistry = await this.toolRegistry;

    const newToolCallsPromises: Promise<ToolCall>[] = requestsToProcess.map(
      async (reqInfo): Promise<ToolCall> => {
        const toolInstance = toolRegistry.getTool(reqInfo.name);
        if (!toolInstance) {
          return {
            status: 'error',
            request: reqInfo,
            response: await createErrorResponse(
              reqInfo,
              new Error(`Tool "${reqInfo.name}" not found in registry.`),
              this.config.getGeminiClient(),
              signal,
            ),
            durationMs: 0,
          };
        }
        return {
          status: 'validating',
          request: reqInfo,
          tool: toolInstance,
          startTime: Date.now(),
        };
      },
    );
    const newToolCalls = await Promise.all(newToolCallsPromises);

    this.toolCalls = this.toolCalls.concat(newToolCalls);
    this.notifyToolCallsUpdate();

    for (const toolCall of newToolCalls) {
      if (toolCall.status !== 'validating') {
        continue;
      }

      const { request: reqInfo, tool: toolInstance } =
        toolCall as ValidatingToolCall;
      try {
        if (this.approvalMode === ApprovalMode.YOLO) {
          this.setStatusInternal(reqInfo.callId, 'scheduled');
        } else {
          const confirmationDetails = await toolInstance.shouldConfirmExecute(
            reqInfo.args,
            signal,
          );

          if (confirmationDetails) {
            const originalOnConfirm = confirmationDetails.onConfirm;
            const wrappedConfirmationDetails: ToolCallConfirmationDetails = {
              ...confirmationDetails,
              onConfirm: (outcome: ToolConfirmationOutcome) =>
                this.handleConfirmationResponse(
                  reqInfo.callId,
                  originalOnConfirm,
                  outcome,
                  signal,
                ),
            };
            this.setStatusInternal(
              reqInfo.callId,
              'awaiting_approval',
              wrappedConfirmationDetails,
            );
          } else {
            this.setStatusInternal(reqInfo.callId, 'scheduled');
          }
        }
      } catch (error) {
        this.setStatusInternal(
          reqInfo.callId,
          'error',
          await createErrorResponse(
            reqInfo,
            error instanceof Error ? error : new Error(String(error)),
            this.config.getGeminiClient(),
            signal,
          ),
        );
      }
    }

    this.attemptExecutionOfScheduledCalls(signal);
    this.checkAndNotifyCompletion();
  }

  async handleConfirmationResponse(
    callId: string,
    originalOnConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>,
    outcome: ToolConfirmationOutcome,
    signal: AbortSignal,
  ): Promise<void> {
    const toolCall = this.toolCalls.find(
      (c) => c.request.callId === callId && c.status === 'awaiting_approval',
    );

    if (toolCall && toolCall.status === 'awaiting_approval') {
      await originalOnConfirm(outcome);
    }

    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== callId) return call;
      return {
        ...call,
        outcome,
      };
    });

    if (outcome === ToolConfirmationOutcome.Cancel || signal.aborted) {
      this.setStatusInternal(
        callId,
        'cancelled',
        'User did not allow tool call',
      );
    } else if (outcome === ToolConfirmationOutcome.ModifyWithEditor) {
      const waitingToolCall = toolCall as WaitingToolCall;
      if (isModifiableTool(waitingToolCall.tool)) {
        const modifyContext = waitingToolCall.tool.getModifyContext(signal);
        const editorType = this.getPreferredEditor();
        if (!editorType) {
          return;
        }

        this.setStatusInternal(callId, 'awaiting_approval', {
          ...waitingToolCall.confirmationDetails,
          isModifying: true,
        } as ToolCallConfirmationDetails);

        const { updatedParams, updatedDiff } = await modifyWithEditor<
          typeof waitingToolCall.request.args
        >(
          waitingToolCall.request.args,
          modifyContext as ModifyContext<typeof waitingToolCall.request.args>,
          editorType,
          signal,
        );
        this.setArgsInternal(callId, updatedParams);
        this.setStatusInternal(callId, 'awaiting_approval', {
          ...waitingToolCall.confirmationDetails,
          fileDiff: updatedDiff,
          isModifying: false,
        } as ToolCallConfirmationDetails);
      }
    } else {
      this.setStatusInternal(callId, 'scheduled');
    }
    this.attemptExecutionOfScheduledCalls(signal);
  }

  private attemptExecutionOfScheduledCalls(signal: AbortSignal): void {
    const allCallsFinalOrScheduled = this.toolCalls.every(
      (call) =>
        call.status === 'scheduled' ||
        call.status === 'cancelled' ||
        call.status === 'success' ||
        call.status === 'error',
    );

    if (allCallsFinalOrScheduled) {
      const callsToExecute = this.toolCalls.filter(
        (call) => call.status === 'scheduled',
      );

      callsToExecute.forEach((toolCall) => {
        if (toolCall.status !== 'scheduled') return;

        const scheduledCall = toolCall as ScheduledToolCall;
        const { callId, name: toolName } = scheduledCall.request;
        this.setStatusInternal(callId, 'executing');

        const liveOutputCallback =
          scheduledCall.tool.canUpdateOutput && this.outputUpdateHandler
            ? (outputChunk: string) => {
                if (this.outputUpdateHandler) {
                  this.outputUpdateHandler(callId, outputChunk);
                }
                this.toolCalls = this.toolCalls.map((tc) =>
                  tc.request.callId === callId && tc.status === 'executing'
                    ? { ...(tc as ExecutingToolCall), liveOutput: outputChunk }
                    : tc,
                );
                this.notifyToolCallsUpdate();
              }
            : undefined;

        scheduledCall.tool
          .execute(scheduledCall.request.args, signal, liveOutputCallback)
          .then(async (toolResult: ToolResult) => {
            if (signal.aborted) {
              this.setStatusInternal(
                callId,
                'cancelled',
                'User cancelled tool execution.',
              );
              return;
            }

            const response = await convertToFunctionResponse(
              toolName,
              callId,
              toolResult.llmContent,
              this.config.getGeminiClient(),
              signal,
            );

            const successResponse: ToolCallResponseInfo = {
              callId,
              responseParts: response,
              resultDisplay: toolResult.returnDisplay,
              error: undefined,
            };
            this.setStatusInternal(callId, 'success', successResponse);
          })
          .catch(async (executionError: Error) => {
            this.setStatusInternal(
              callId,
              'error',
              await createErrorResponse(
                scheduledCall.request,
                executionError instanceof Error
                  ? executionError
                  : new Error(String(executionError)),
                this.config.getGeminiClient(),
                signal,
              ),
            );
          });
      });
    }
  }

  private checkAndNotifyCompletion(): void {
    const allCallsAreTerminal = this.toolCalls.every(
      (call) =>
        call.status === 'success' ||
        call.status === 'error' ||
        call.status === 'cancelled',
    );

    if (this.toolCalls.length > 0 && allCallsAreTerminal) {
      const completedCalls = [...this.toolCalls] as CompletedToolCall[];
      this.toolCalls = [];

      for (const call of completedCalls) {
        logToolCall(this.config, new ToolCallEvent(call));
      }

      if (this.onAllToolCallsComplete) {
        this.onAllToolCallsComplete(completedCalls);
      }
      this.notifyToolCallsUpdate();
    }
  }

  private notifyToolCallsUpdate(): void {
    if (this.onToolCallsUpdate) {
      this.onToolCallsUpdate([...this.toolCalls]);
    }
  }
}
