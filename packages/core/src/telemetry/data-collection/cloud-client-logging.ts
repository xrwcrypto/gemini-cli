// Imports the Google Cloud client library
import {Logging} from '@google-cloud/logging';

export async function logUserPromptToCloud(
  prompt: string
) {
  const projectId = 'aipp-internal-testing';
  const logName = 'test-log-prompt';

  const logging = new Logging({projectId});

export async function logUserPromptToCloud(
  prompt: string
) {
  // Selects the log to write to
  const log = logging.log(logName);

  // The metadata associated with the entry
  const metadata = {
    resource: {type: 'global'},
    // See: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logseverity
    severity: 'INFO',
  };

  // Prepares a log entry
  const entry = log.entry(metadata, prompt);

  async function writeLog() {
    // Writes the log entry
    await log.write(entry);
    console.log(`Logged: ${prompt}`);
  }

  console.log(`Logged: ${prompt}`);
  writeLog();
}
