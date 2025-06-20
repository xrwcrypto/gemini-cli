
// Defines valid event metadata keys for Clearcut logging.
export enum EventMetadataKey {
  GEMINI_CLI_KEY_UNKNOWN = 0,

  // ==========================================================================
  // Start Session Event Keys
  // ===========================================================================

  // Logs the model id used in the session.
  GEMINI_CLI_START_SESSION_MODEL = 1,

  // Logs the embedding model id used in the session.
  GEMINI_CLI_START_SESSION_EMBEDDING_MODEL = 2,

  // Logs the sandbox that was used in the session.
  GEMINI_CLI_START_SESSION_SANDBOX = 3,

  // Logs the core tools that were enabled in the session.
  GEMINI_CLI_START_SESSION_CORE_TOOLS = 4,

  // Logs the approval mode that was used in the session.
  GEMINI_CLI_START_SESSION_APPROVAL_MODE = 5,

  // Logs whether an API key was used in the session.
  GEMINI_CLI_START_SESSION_API_KEY_ENABLED = 6,

  // Logs whether the Vertex API was used in the session.
  GEMINI_CLI_START_SESSION_VERTEX_API_ENABLED = 7,

  // Logs whether Code Assist was enabled in the session.
  GEMINI_CLI_START_SESSION_CODE_ASSIST_ENABLED = 8,

  // Logs whether debug mode was enabled in the session.
  GEMINI_CLI_START_SESSION_DEBUG_MODE_ENABLED = 9,

  // Logs the MCP servers that were enabled in the session.
  GEMINI_CLI_START_SESSION_MCP_SERVERS = 10,

  // Logs whether user-collected telemetry was enabled in the session.
  GEMINI_CLI_START_SESSION_TELEMETRY_ENABLED = 11,

  // Logs whether prompt collection was enabled for user-collected telemetry.
  GEMINI_CLI_START_SESSION_TELEMETRY_LOG_USER_PROMPTS_ENABLED = 12,

  // Logs whether the session was configured to respect gitignore files.
  GEMINI_CLI_START_SESSION_RESPECT_GITIGNORE = 13,

  // Logs whether build artifacts were allowed during the session.
  GEMINI_CLI_START_SESSION_ALLOW_BUILD_ARTIFACTS = 14,

  // ==========================================================================
  // User Prompt Event Keys
  // ===========================================================================

  // Logs the length of the prompt.
  GEMINI_CLI_USER_PROMPT_LENGTH = 15,

  // ==========================================================================
  // Tool Call Event Keys
  // ===========================================================================

  // Logs the function name.
  GEMINI_CLI_TOOL_CALL_NAME = 16,

  // Logs the user's decision about how to handle the tool call.
  GEMINI_CLI_TOOL_CALL_DECISION = 17,

  // Logs whether the tool call succeeded.
  GEMINI_CLI_TOOL_CALL_SUCCESS = 18,

  // Logs the tool call duration in milliseconds.
  GEMINI_CLI_TOOL_CALL_DURATION_MS = 19,

  // Logs the tool call error message, if any.
  GEMINI_CLI_TOOL_ERROR_MESSAGE = 20,

  // Logs the tool call error type, if any.
  GEMINI_CLI_TOOL_CALL_ERROR_TYPE = 21,

  // ==========================================================================
  // GenAI API Request Event Keys
  // ===========================================================================

  // Logs the model id of the request.
  GEMINI_CLI_API_REQUEST_MODEL = 22,

  // ==========================================================================
  // GenAI API Response Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  GEMINI_CLI_API_RESPONSE_MODEL = 23,

  // Logs the status code of the response.
  GEMINI_CLI_API_RESPONSE_STATUS_CODE = 24,

  // Logs the duration of the API call in milliseconds.
  GEMINI_CLI_API_RESPONSE_DURATION_MS = 25,

  // Logs the error message of the API call, if any.
  GEMINI_CLI_API_ERROR_MESSAGE = 26,

  // Logs the input token count of the API call.
  GEMINI_CLI_API_RESPONSE_INPUT_TOKEN_COUNT = 27,

  // Logs the output token count of the API call.
  GEMINI_CLI_API_RESPONSE_OUTPUT_TOKEN_COUNT = 28,

  // Logs the cached token count of the API call.
  GEMINI_CLI_API_RESPONSE_CACHED_TOKEN_COUNT = 29,

  // Logs the thinking token count of the API call.
  GEMINI_CLI_API_RESPONSE_THINKING_TOKEN_COUNT = 30,

  // Logs the tool use token count of the API call.
  GEMINI_CLI_API_RESPONSE_TOOL_TOKEN_COUNT = 31,

  // ==========================================================================
  // GenAI API Error Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  GEMINI_CLI_API_ERROR_MODEL = 32,

  // Logs the error type.
  GEMINI_CLI_API_ERROR_TYPE = 33,

  // Logs the status code of the error response.
  GEMINI_CLI_API_ERROR_STATUS_CODE = 34,

  // Logs the duration of the API call in milliseconds.
  GEMINI_CLI_API_ERROR_DURATION_MS = 35,

  // ==========================================================================
  // End Session Event Keys
  // ===========================================================================

  // Logs the end of a session.
  GEMINI_CLI_END_SESSION_ID = 36,
}

export function getEventMetadataKey(keyName: string): EventMetadataKey | undefined {
  // Access the enum member by its string name
  const key = EventMetadataKey[keyName as keyof typeof EventMetadataKey];

  // Check if the result is a valid enum member (not undefined and is a number)
  if (typeof key === 'number') {
    return key;
  }
  return undefined;
}