import { Buffer } from 'buffer';
import * as https from 'https';
import { CliConfigEvent, UserPromptEvent, ToolCallEvent, ApiRequestEvent, ApiResponseEvent, ApiErrorEvent, StartSessionEvent } from '../types.js';
import { EventMetadataKey, getEventMetadataKey } from './event-metadata-key.js';
import { Config } from '../../config/config.js';

const new_session_event_name = 'new_session';
const new_prompt_event_name = 'new_prompt';
const tool_call_event_name = 'tool_call';
const api_request_event_name = "api_request";
const api_response_event_name = "api_response";
const api_error_event_name = "api_error";

enum NewSessionEventData {
  model,
  embedding_model,
  sandbox_enabled,
  core_tools_enabled,
  api_key_enabled,
  vertex_ai_enabled,
  code_assist_enabled,
  file_filtering_respect_git_ignore,
  file_filtering_allow_build_artifacts,
  debug_mode,
  mcp_servers,
}

enum NewPromptEventData {
  prompt_length,
  prompt,
}

enum ToolCallEventData {
  function_name,
  function_args,
  decision,
  success,
  duration_ms,
  error_message,
  error_type,
}

enum ApiRequestEventData {
  model,
  request_text,
}

enum ApiResponseEventData {
  model,
  response_text,
  duration_ms,
  status_code,
  error,
  input_token_count,
  output_token_count,
  cached_content_token_count,
  thoughts_token_count,
  tool_token_count,
}

enum ApiErrorEventData {
  model,
  error,
  duration,
  status_code,
  error_type,
}

export interface LogResponse {
  nextRequestWaitMs?: number;
}

// Singleton class for batch posting log events to Clearcut. When a new event comes in, the elapsed time
// is checked and events are flushed to Clearcut if at least a minute has passed since the last flush.
export class ClearcutLogger {
  private static instance: ClearcutLogger;
  private config?: Config;
  private readonly events: any = [];
  private last_flush_time: number = Date.now();
  private flush_interval_ms: number = 1000 * 60; // Wait at least a minute before flushing events.

  private constructor(config?: Config) {
    this.config = config;
  }

  public static getInstance(config?: Config): ClearcutLogger {
    if (!ClearcutLogger.instance) {
        ClearcutLogger.instance = new ClearcutLogger(config);
    }
    return ClearcutLogger.instance;
  }

  enqueueLogEvent(event: any): void {
    this.events.push(
      [({
        event_time_ms: Date.now(),
        source_extension_json: JSON.stringify(event),
      })]
    );
  }

  createLogEvent(name: string, data: Map<EventMetadataKey, string>): object {
    return {
      Application: "GEMINI_CLI",
      event_name: name,
      event_metadata: [data] as object[],
    };
  }

  flushIfNeeded(): void {
    if (Date.now() - this.last_flush_time < this.flush_interval_ms) {
      return;
    }

    this.flushToClearcut();
    this.last_flush_time = Date.now();
  }

  flushToClearcut(): Promise<LogResponse> {
    return new Promise<Buffer>((resolve, reject) => {
      const request = [({
        log_source_name: 'CONCORD',
        request_time_ms: Date.now(),
        log_event: this.events,
      })];
      const body = JSON.stringify(request);
      const options = {
        hostname: 'play.googleapis.com',
        path: '/log',
        method: 'POST',
        headers: { 'Content-Length': Buffer.byteLength(body) },
      };
      const bufs: Buffer[] = [];
      const req = https.request(options, res => {
        res.on('data', buf => bufs.push(buf));
        res.on('end', () => {
        resolve(Buffer.concat(bufs));
      });
    });
    req.on('error', e => {
      reject(e);
    });
    req.end(body);
    }).then((buf: Buffer) => {
      try {
        this.events.length = 0;
        return this.decodeLogResponse(buf) || {};
      } catch {
        return {};
      }
    });
  }

  // Visible for testing. Decodes protobuf-encoded response from Clearcut server.
  decodeLogResponse(buf: Buffer): LogResponse | undefined {
    if (buf.length < 1) {
      return undefined;
    }

    // The first byte of the buffer is `field<<3 | type`. We're looking for field
    // 1, with type varint, represented by type=0. If the first byte isn't 8, that
    // means field 1 is missing or the message is corrupted. Either way, we return
    // undefined.
    if (buf.readUInt8(0) !== 8) {
      return undefined;
    }

    let ms = BigInt(0);
    let cont = true;

    // In each byte, the most significant bit is the continuation bit. If it's
    // set, we keep going. The lowest 7 bits, are data bits. They are concatenated
    // in reverse order to form the final number.
    for (let i = 1; cont && i < buf.length; i++) {
      const byte = buf.readUInt8(i);
      ms |= BigInt(byte & 0x7f) << BigInt(7 * (i - 1));
      cont = (byte & 0x80) !== 0;
    }

    if (cont) {
      // We have fallen off the buffer without seeing a terminating byte. The
      // message is corrupted.
      return undefined;
    }
    return {
      nextRequestWaitMs: Number(ms),
    };
  }

  logStartSessionEvent(event: StartSessionEvent): void {
    const config = event.config;
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_MODELS, config.getModel());
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_SANDBOX, JSON.stringify(config.getSandbox()));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_CORE_TOOLS, JSON.stringify(config.getCoreTools()));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_API_KEY_ENABLED, JSON.stringify(!!config.getContentGeneratorConfig().apiKey));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_VERTEX_API_ENABLED, JSON.stringify(!!config.getContentGeneratorConfig().vertexai));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_CODE_ASSIST_ENABLED, JSON.stringify(!!config.getContentGeneratorConfig().codeAssist));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_DEBUG_MODE_ENABLED, JSON.stringify(config.getDebugMode()));
    data.set(EventMetadataKey.GEMINI_CLI_NEW_SESSION_MCP_SERVERS, JSON.stringify(config.getMcpServers()));

    this.enqueueLogEvent(this.createLogEvent(new_session_event_name, data));
    this.flushIfNeeded();
  }

  logNewPromptEvent(event: UserPromptEvent): void {
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_NEW_PROMPT_LENGTH, JSON.stringify(event.prompt_length));

    this.enqueueLogEvent(this.createLogEvent(new_prompt_event_name, data));
    this.flushIfNeeded();
  }

  logToolCallEvent(event: ToolCallEvent): void {
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_TOOL_CALL_NAME, event.function_name);
    data.set(EventMetadataKey.GEMINI_CLI_TOOL_CALL_DECISION, JSON.stringify(event.decision));
    data.set(EventMetadataKey.GEMINI_CLI_TOOL_CALL_SUCCESS, JSON.stringify(event.success));
    data.set(EventMetadataKey.GEMINI_CLI_TOOL_CALL_DURATION_MS, JSON.stringify(event.duration_ms));
    data.set(EventMetadataKey.GEMINI_CLI_TOOL_ERROR_MESSAGE, JSON.stringify(event.error));
    data.set(EventMetadataKey.GEMINI_CLI_TOOL_CALL_ERROR_TYPE, JSON.stringify(event.error_type));

    this.enqueueLogEvent(this.createLogEvent(tool_call_event_name, data));
    this.flushIfNeeded();
  }

  logApiRequestEvent(event: ApiRequestEvent): void {
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_API_REQUEST_MODEL, event.model);

    this.enqueueLogEvent(this.createLogEvent(api_request_event_name, data));
    this.flushIfNeeded();
  }

  logApiResponseEvent(event: ApiResponseEvent): void {
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_MODEL, event.model);
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_STATUS_CODE, JSON.stringify(event.status_code));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_DURATION_MS, JSON.stringify(event.duration_ms));
    data.set(EventMetadataKey.GEMINI_CLI_API_ERROR_MESSAGE, JSON.stringify(event.error));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_INPUT_TOKEN_COUNT, JSON.stringify(event.input_token_count));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_OUTPUT_TOKEN_COUNT, JSON.stringify(event.output_token_count));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_CACHED_TOKEN_COUNT, JSON.stringify(event.cached_content_token_count));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_THINKING_TOKEN_COUNT, JSON.stringify(event.thoughts_token_count));
    data.set(EventMetadataKey.GEMINI_CLI_API_RESPONSE_TOOL_TOKEN_COUNT, JSON.stringify(event.tool_token_count));

    this.enqueueLogEvent(this.createLogEvent(api_response_event_name, data));
    this.flushIfNeeded();
  };

  logApiErrorEvent(event: ApiErrorEvent): void {
    const data : Map<EventMetadataKey, string> = new Map();

    data.set(EventMetadataKey.GEMINI_CLI_API_ERROR_MODEL, event.model);
    data.set(EventMetadataKey.GEMINI_CLI_API_ERROR_TYPE, JSON.stringify(event.error_type));
    data.set(EventMetadataKey.GEMINI_CLI_API_ERROR_STATUS_CODE, JSON.stringify(event.status_code));
    data.set(EventMetadataKey.GEMINI_CLI_API_ERROR_DURATION_MS, JSON.stringify(event.duration_ms));

    this.enqueueLogEvent(this.createLogEvent(api_error_event_name, data));
    this.flushIfNeeded();
  };
}