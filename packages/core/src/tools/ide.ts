import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { BaseTool, ToolResult } from './tools.js';

async function isVscodeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('code --version', (error) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function getOpenCommand(): string {
  switch (os.platform()) {
    case 'darwin':
      return 'open';
    case 'linux':
      return 'xdg-open';
    default:
      return 'start';
  }
}

export class IdeOpenDiffTool extends BaseTool {
  static async isSupported(): Promise<boolean> {
    return isVscodeInstalled();
  }

  constructor() {
    super(
      'ide_open_diff',
      'Opens a diff view in the user-s IDE',
      'Opens a diff view in the user-s IDE, allowing them to see the changes between two files.',
      {
        properties: {
          left: {
            description: 'The absolute path to the left file for the diff.',
            type: 'string',
          },
          right: {
            description: 'The absolute path to the right file for the diff.',
            type: 'string',
          },
        },
        required: ['left', 'right'],
        type: 'object',
      }
    );
  }

  async execute(args: { left: string; right: string }): Promise<ToolResult> {
    const leftPath = path.resolve(args.left);
    const rightPath = path.resolve(args.right);
    const command = `${getOpenCommand()} "vscode://google.geminicodeassist/open_diff?left=${leftPath}&right=${rightPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          return reject(stderr);
        }
        resolve({
          llmContent: `Successfully opened diff view for ${leftPath} and ${rightPath}`,
          returnDisplay: `Successfully opened diff view for ${leftPath} and ${rightPath}`,
        });
      });
    });
  }
}

export class IdeOpenFileTool extends BaseTool {
  static async isSupported(): Promise<boolean> {
    return isVscodeInstalled();
  }

  constructor() {
    super(
      'ide_open_file',
      'Opens a file in the user-s IDE',
      'Opens a file in the user-s IDE, allowing them to view or edit it.',
      {
        properties: {
          path: {
            description: 'The absolute path to the file to open.',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      }
    );
  }

  async execute(args: { path: string }): Promise<ToolResult> {
    const filePath = path.resolve(args.path);
    const command = `${getOpenCommand()} "vscode://file/${filePath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          return reject(stderr);
        }
        resolve({
          llmContent: `Successfully opened ${filePath}`,
          returnDisplay: `Successfully opened ${filePath}`,
        });
      });
    });
  }
}
