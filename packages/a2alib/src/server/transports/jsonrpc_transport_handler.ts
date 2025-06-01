/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  JSONRPCErrorResponse,
  A2AResponse,
  A2ARequest,
  SendStreamingMessageSuccessResponse,
  SendMessageSuccessResponse, // Added import
  GetTaskSuccessResponse, // Added import
  CancelTaskSuccessResponse, // Added import
  SetTaskPushNotificationConfigSuccessResponse, // Added import
  GetTaskPushNotificationConfigSuccessResponse, // Added import
} from '../../schema.js';
import { A2AError } from '../error.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';

/**
 * Handles JSON-RPC transport layer, routing requests to A2ARequestHandler.
 */
export class JsonRpcTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  /**
   * Handles an incoming JSON-RPC request.
   * For streaming methods, it returns an AsyncGenerator of JSONRPCResult.
   * For non-streaming methods, it returns a Promise of a single JSONRPCMessage (Result or ErrorResponse).
   */
  async handle(
    requestBody: unknown,
  ): Promise<A2AResponse | AsyncGenerator<A2AResponse, void, undefined>> {
    let rpcRequest: A2ARequest | undefined = undefined;

    try {
      if (typeof requestBody === 'string') {
        // Attempt to parse, then cast. Further validation will confirm.
        rpcRequest = JSON.parse(requestBody) as A2ARequest;
      } else if (typeof requestBody === 'object' && requestBody !== null) {
        // Cast. Further validation will confirm.
        rpcRequest = requestBody as A2ARequest;
      } else {
        throw A2AError.parseError('Invalid request body type.');
      }

      if (
        rpcRequest.jsonrpc !== '2.0' ||
        !rpcRequest.method ||
        typeof rpcRequest.method !== 'string'
      ) {
        throw A2AError.invalidRequest('Invalid JSON-RPC request structure.');
      }
      // At this point, rpcRequest is asserted to be A2ARequest and has basic structure.
      // Specific params validation happens in the A2ARequestHandler implementations implicitly
      // or explicitly if needed.
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown parsing error';
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.parseError(
              errorMessage || 'Failed to parse JSON request.',
            );
      // Try to get ID from the original requestBody or parsed rpcRequest
      let parsedId: string | number | null = null;
      if (rpcRequest && typeof rpcRequest.id !== 'undefined') {
        // If rpcRequest was assigned (even if it failed validation later)
        parsedId = rpcRequest.id;
      } else if (
        typeof requestBody === 'object' &&
        requestBody !== null &&
        'id' in requestBody
      ) {
        // Fallback to raw requestBody if rpcRequest is not yet assigned or has no id
        const rawId = (requestBody as { id?: string | number | null }).id;
        // Ensure rawId is of a valid type for JSON-RPC id
        if (
          typeof rawId === 'string' ||
          typeof rawId === 'number' ||
          rawId === null
        ) {
          parsedId = rawId;
        }
      }

      return {
        jsonrpc: '2.0',
        id: parsedId,
        error: a2aError.toJSONRPCError(),
      } as JSONRPCErrorResponse;
    }

    // Now rpcRequest is of type A2ARequest. Typescript will narrow it in the switch.
    const { method, params, id: requestId = null } = rpcRequest;

    try {
      if (method === 'message/stream' || method === 'tasks/resubscribe') {
        const agentCard = await this.requestHandler.getAgentCard();
        if (!agentCard.capabilities.streaming) {
          throw A2AError.unsupportedOperation(
            `Method ${method} requires streaming capability.`,
          );
        }
        const agentEventStream =
          method === 'message/stream'
            ? this.requestHandler.sendMessageStream(params)
            : this.requestHandler.resubscribe(params);

        // Wrap the agent event stream into a JSON-RPC result stream
        return (async function* jsonRpcEventStream(): AsyncGenerator<
          SendStreamingMessageSuccessResponse,
          void,
          undefined
        > {
          try {
            for await (const event of agentEventStream) {
              yield {
                jsonrpc: '2.0',
                id: requestId, // Use the original request ID for all streamed responses
                result: event,
              };
            }
          } catch (streamError) {
            // If the underlying agent stream throws an error, we need to yield a JSONRPCErrorResponse.
            // However, an AsyncGenerator is expected to yield JSONRPCResult.
            // This indicates an issue with how errors from the agent's stream are propagated.
            // For now, log it. The Express layer will handle the generator ending.
            const streamErrorMessage =
              streamError instanceof Error
                ? streamError.message
                : 'Unknown streaming error';
            console.error(
              `Error in agent event stream for ${method} (request ${requestId}):`,
              streamError,
            );
            // Ideally, the Express layer should catch this and send a final error to the client if the stream breaks.
            // Or, the agentEventStream itself should yield a final error event that gets wrapped.
            // For now, we re-throw so it can be caught by A2AExpressApp's stream handling.
            throw A2AError.internalError(streamErrorMessage);
          }
        })();
      } else {
        // Handle non-streaming methods
        let result:
          | SendMessageSuccessResponse['result']
          | GetTaskSuccessResponse['result']
          | CancelTaskSuccessResponse['result']
          | SetTaskPushNotificationConfigSuccessResponse['result']
          | GetTaskPushNotificationConfigSuccessResponse['result'];
        switch (method) {
          case 'message/send':
            result = await this.requestHandler.sendMessage(params);
            break;
          case 'tasks/get':
            result = await this.requestHandler.getTask(params);
            break;
          case 'tasks/cancel':
            result = await this.requestHandler.cancelTask(params);
            break;
          case 'tasks/pushNotificationConfig/set':
            result =
              await this.requestHandler.setTaskPushNotificationConfig(params);
            break;
          case 'tasks/pushNotificationConfig/get':
            result =
              await this.requestHandler.getTaskPushNotificationConfig(params);
            break;
          default:
            throw A2AError.methodNotFound(method);
        }
        return {
          jsonrpc: '2.0',
          id: requestId,
          result,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(
              errorMessage || 'An unexpected error occurred.',
            );
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: a2aError.toJSONRPCError(),
      } as JSONRPCErrorResponse;
    }
  }
}
