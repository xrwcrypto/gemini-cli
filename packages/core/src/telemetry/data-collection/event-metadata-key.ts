
// Defines valid event metadata keys for Clearcut logging.
export enum EventMetadataKey {
  // ==========================================================================
  // New Session Event Keys
  // ===========================================================================

  // Logs the model ids used in the session.
  GEMINI_CLI_NEW_SESSION_MODELS = 1,

  // Logs the sandbox that was used in the session.
  GEMINI_CLI_NEW_SESSION_SANDBOX = 2,

  // Logs the core tools were that were enabled in the session.
  GEMINI_CLI_NEW_SESSION_CORE_TOOLS = 3,

  // Logs whether an API key was used in the session.
  GEMINI_CLI_NEW_SESSION_API_KEY_ENABLED = 4,

  // Logs whether the Vertex API was used in the session.
  GEMINI_CLI_NEW_SESSION_VERTEX_API_ENABLED = 5,

  // Logs whether Code Assist was enabled in the session.
  GEMINI_CLI_NEW_SESSION_CODE_ASSIST_ENABLED = 6,

  // Logs whether debug mode was enabled in the session.
  GEMINI_CLI_NEW_SESSION_DEBUG_MODE_ENABLED = 7,

  // Logs the MCP servers that were enabled in the session.
  GEMINI_CLI_NEW_SESSION_MCP_SERVERS = 8,

  // ==========================================================================
  // New Prompt Event Keys
  // ===========================================================================

  // Logs the length of the prompt.
  GEMINI_CLI_NEW_PROMPT_LENGTH = 9,

  // ==========================================================================
  // Tool Call Event Keys
  // ===========================================================================

  // Logs the function name.
  GEMINI_CLI_TOOL_CALL_NAME = 10,

  // Logs the user's decision about how to handle the tool call.
  GEMINI_CLI_TOOL_CALL_DECISION = 11,

  // Logs whether the tool call succeeded.
  GEMINI_CLI_TOOL_CALL_SUCCESS = 12,

  // Logs the tool call duration in milliseconds.
  GEMINI_CLI_TOOL_CALL_DURATION_MS = 13,

  // Logs the tool call error message, if any.
  GEMINI_CLI_TOOL_ERROR_MESSAGE = 14,

  // Logs the tool call error type, if any.
  GEMINI_CLI_TOOL_CALL_ERROR_TYPE = 15,

  // ==========================================================================
  // GenAI API Request Event Keys
  // ===========================================================================

  // Logs the model id of the request.
  GEMINI_CLI_API_REQUEST_MODEL = 16,

  // ==========================================================================
  // GenAI API Response Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  GEMINI_CLI_API_RESPONSE_MODEL = 17,

  // Logs the status code of the response.
  GEMINI_CLI_API_RESPONSE_STATUS_CODE = 18,

  // Logs the duration of the API call in milliseconds.
  GEMINI_CLI_API_RESPONSE_DURATION_MS = 19,

  // Logs the error message of the API call, if any.
  GEMINI_CLI_API_ERROR_MESSAGE = 20,

  // Logs the input token count of the API call.
  GEMINI_CLI_API_RESPONSE_INPUT_TOKEN_COUNT = 21,

  // Logs the output token count of the API call.
  GEMINI_CLI_API_RESPONSE_OUTPUT_TOKEN_COUNT = 22,

  // Logs the cached token count of the API call.
  GEMINI_CLI_API_RESPONSE_CACHED_TOKEN_COUNT = 23,

  // Logs the thinking token count of the API call.
  GEMINI_CLI_API_RESPONSE_THINKING_TOKEN_COUNT = 24,

  // Logs the tool use token count of the API call.
  GEMINI_CLI_API_RESPONSE_TOOL_TOKEN_COUNT = 25,

  // ==========================================================================
  // GenAI API Error Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  GEMINI_CLI_API_ERROR_MODEL = 26,

  // Logs the error type.
  GEMINI_CLI_API_ERROR_TYPE = 27,

  // Logs the status code of the error response.
  GEMINI_CLI_API_ERROR_STATUS_CODE = 28,

  // Logs the duration of the API call in milliseconds.
  GEMINI_CLI_API_ERROR_DURATION_MS = 29,
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