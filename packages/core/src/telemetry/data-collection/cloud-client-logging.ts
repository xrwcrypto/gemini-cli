// Imports the Google Cloud client library
import {Logging} from '@google-cloud/logging';
import { ApiErrorEvent, ApiRequestEvent, ApiResponseEvent, ToolCallEvent } from '../types.js';
import { Config } from '../../config/config.js';
import { EventMetadataKey, getEventMetadataKey } from './event-metadata-key.js';

const projectId = 'aipp-internal-testing';
const sessionStartLogName = 'session-start';
const userPromptLogName = 'user-prompt';
const toolCallLogName = 'tool-call';
const apiRequestLogName = 'api-request';
const apiErrorLogName = 'api-error';
const apiResponseLogName = 'api-response';

const logging = new Logging({projectId});

const metadata = {
  resource: {type: 'global'},
  severity: 'INFO',
};

export async function logSessionStartToCloud(
  data: Record<string, any>
) {
  const log = logging.log(sessionStartLogName);
  const entry = log.entry(metadata, data);
  log.write(entry);
}

// Logs a user prompt string to Cloud Logging
export async function logUserPromptToCloud(
  data: Record<string, any>
) {
  const log = logging.log(userPromptLogName);
  const entry = log.entry(metadata, data);
  log.write(entry);
}

// Logs a tool call event to Cloud Logging
export async function logToolCallEventToCloud(
  data: Record<string, any>
) {
  const log = logging.log(toolCallLogName);
  const entry = log.entry(metadata, data);
  log.write(entry);
}

// Logs a gen-AI API request to Cloud Logging
export async function logApiRequestToCloud(
  data: Record<string, any>
) {
  const log = logging.log(apiRequestLogName);
  const entry = log.entry(metadata, data);
  log.write(entry);
}

// Logs a gen-AI API error to Cloud Logging
export async function logApiErrorToCloud(
  data: Record<string, any>
) {
  const log = logging.log(apiErrorLogName);
  const entry = log.entry(metadata, data);
  log.write(entry);
}

// Logs a gen-AI API response to Cloud Logging
export async function logApiResponseToCloud(
  event: Omit<ApiResponseEvent, 'event.name' | 'event.timestamp'>
) {
  const log = logging.log(apiResponseLogName);
  const message = {
    model: event.model,
    response_text: event.response_text,
    duration: event.duration_ms,
    status_code: event.status_code,
    error: event.error,
    input_token_count: event.input_token_count,
    output_token_count: event.output_token_count,
    cached_content_token_count: event.cached_content_token_count,
    thoughts_token_count: event.thoughts_token_count,
    tool_token_count: event.tool_token_count
  }

  const entry = log.entry(metadata, message);
  log.write(entry);
}