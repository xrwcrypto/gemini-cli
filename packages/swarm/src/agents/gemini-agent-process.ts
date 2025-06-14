/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'eventemitter3';
import { BaseAgent } from '../roles/base-agent.js';
import type {
  SwarmTask,
  AgentConfig,
  SwarmMessage,
} from '../types/index.js';
import { AgentRole } from '../types/index.js';
import { AgentStatus, TaskStatus, MessageType } from '../types/index.js';
import type { MessageBus } from '../communication/message-bus.js';
import { swarmLogger } from '../utils/swarm-logger.js';

interface AgentMessage {
  type: 'TASK' | 'RESULT' | 'ERROR' | 'STATUS' | 'LOG';
  taskId?: string;
  content: any;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface GeminiAgentConfig extends AgentConfig {
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  workingDirectory?: string;
}

/**
 * A Gemini CLI agent that runs as a separate process
 */
export class GeminiAgentProcess extends BaseAgent {
  private process?: ChildProcess;
  private outputBuffer: string = '';
  private errorBuffer: string = '';
  private responseEmitter = new EventEmitter();
  private isProcessing = false;
  private messageQueue: AgentMessage[] = [];

  constructor(messageBus: MessageBus, config: GeminiAgentConfig) {
    super(config, messageBus);
  }

  /**
   * Spawn the Gemini CLI process
   */
  async spawn(): Promise<void> {
    await super.spawn();

    const args = this.buildProcessArgs();
    
    swarmLogger.logAgentEvent(this.id, 'Spawning Gemini agent', { 
      role: this.role,
      args: args.slice(0, 5), // Log first few args for debugging
      cwd: process.cwd()
    });
    
    this.process = spawn('node', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        GEMINI_AGENT_MODE: 'true',
        GEMINI_AGENT_ID: this.id,
        GEMINI_AGENT_ROLE: this.role,
        GEMINI_SYSTEM_PROMPT: (this.config as GeminiAgentConfig).systemPrompt || '',
      }
    });

    this.setupProcessHandlers();
    await this.waitForReady();
  }

  /**
   * Build command line arguments for the Gemini CLI
   */
  private buildProcessArgs(): string[] {
    const config = this.config as GeminiAgentConfig;
    const args = [
      './bundle/gemini.js',
      '--model', config.model || 'gemini-1.5-flash',
      '--interactive', 'false', // Set interactive to false for agent mode
    ];

    // Don't add other unsupported flags - pass via environment variables instead
    
    // Add system prompt via stdin instead of command line (to avoid shell escaping issues)
    
    return args;
  }

  /**
   * Set up handlers for process I/O
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      swarmLogger.debug(`Agent-${this.id}`, 'stdout', { output: text.trim() });
      this.outputBuffer += text;
      this.processOutput();
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.errorBuffer += text;
      swarmLogger.error(`Agent-${this.id}`, 'stderr output', { error: text });
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      swarmLogger.logAgentEvent(this.id, 'Process exited', { code, signal });
      this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      swarmLogger.error(`Agent-${this.id}`, 'Process error', { error: error.message, stack: error.stack });
      this.setStatus(AgentStatus.ERROR);
      this.emit('agent:error', { error });
    });
  }

  /**
   * Process output from the Gemini CLI
   */
  private processOutput(): void {
    // Look for complete JSON messages in the output
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      // Try to parse as JSON message
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const message = JSON.parse(line) as AgentMessage;
          this.handleAgentMessage(message);
        } catch (e) {
          // Not JSON, treat as regular output
          this.handleTextOutput(line);
        }
      } else {
        this.handleTextOutput(line);
      }
    }
  }

  /**
   * Handle structured messages from the agent
   */
  private handleAgentMessage(message: AgentMessage): void {
    swarmLogger.debug(`Agent-${this.id}`, 'Received agent message', { messageType: message.type, taskId: message.taskId });

    switch (message.type) {
      case 'RESULT':
        if (message.taskId) {
          // Extract the output from the result
          const output = message.content?.output || message.content;
          
          // Send output to UI
          if (output) {
            this.messageBus.send({
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              from: this.id,
              to: 'swarm-manager',
              type: MessageType.STATUS_UPDATE,
              content: {
                event: 'agent:output',
                agentId: this.id,
                output: output,
                taskId: message.taskId,
                timestamp: new Date()
              },
              timestamp: new Date()
            });
          }
          
          this.responseEmitter.emit(`task:${message.taskId}`, {
            success: true,
            result: message.content
          });
        }
        break;

      case 'ERROR':
        if (message.taskId) {
          this.responseEmitter.emit(`task:${message.taskId}`, {
            success: false,
            error: message.content
          });
        }
        break;

      case 'STATUS':
        this.setStatus(message.content.status);
        break;

      case 'LOG':
        swarmLogger.info(`Agent-${this.id}`, message.content);
        // Also send to UI
        this.messageBus.send({
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          from: this.id,
          to: 'swarm-manager',
          type: MessageType.STATUS_UPDATE,
          content: {
            event: 'agent:output',
            agentId: this.id,
            output: `[LOG] ${message.content}`,
            timestamp: new Date()
          },
          timestamp: new Date()
        });
        break;
    }
  }

  /**
   * Handle plain text output
   */
  private handleTextOutput(text: string): void {
    // Store as activity log
    swarmLogger.debug(`Agent-${this.id}`, 'Plain text output', { output: text });
    this.emit('agent:output', { text });
    
    // Send output to swarm manager for UI display
    this.messageBus.send({
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: this.id,
      to: 'swarm-manager',
      type: MessageType.STATUS_UPDATE,
      content: {
        event: 'agent:output',
        agentId: this.id,
        output: text,
        timestamp: new Date()
      },
      timestamp: new Date()
    });
  }

  /**
   * Wait for the agent process to be ready
   */
  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Agent process failed to start'));
      }, 30000); // 30 second timeout

      // For now, assume ready after a short delay
      // In a real implementation, wait for a READY message
      setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 1000);
    });
  }

  /**
   * Process a task by sending it to the Gemini CLI
   */
  async processTask(task: SwarmTask): Promise<any> {
    if (!this.process || this.process.killed) {
      throw new Error('Agent process not running');
    }

    const taskStartTime = Date.now();
    swarmLogger.logTaskEvent(task.id, 'Task assigned to agent', { agentId: this.id, role: this.role });

    this.setStatus(AgentStatus.EXECUTING);
    this.isProcessing = true;
    
    // Emit task started event
    this.messageBus.send({
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: this.id,
      to: 'swarm-manager',
      type: MessageType.STATUS_UPDATE,
      content: {
        event: 'task:started',
        taskId: task.id,
        agentId: this.id
      },
      timestamp: new Date()
    });

    try {
      // Format the task as a prompt for the Gemini CLI
      const prompt = this.formatTaskPrompt(task);
      swarmLogger.debug(`Agent-${this.id}`, 'Task prompt formatted', { taskId: task.id, promptLength: prompt.length });
      
      // Send the task to the process
      const message: AgentMessage = {
        type: 'TASK',
        taskId: task.id,
        content: { task, prompt },
        timestamp: new Date()
      };

      this.sendToProcess(message);
      swarmLogger.logTaskEvent(task.id, 'Task sent to agent process', { agentId: this.id });

      // Wait for the response
      const result = await this.waitForTaskResponse(task.id);
      
      const duration = Date.now() - taskStartTime;
      swarmLogger.logTaskEvent(task.id, 'Task completed', { 
        agentId: this.id, 
        duration, 
        resultType: typeof result,
        resultSize: JSON.stringify(result).length 
      });
      
      this.setStatus(AgentStatus.IDLE);
      this.isProcessing = false;
      
      // Emit task completed event
      this.messageBus.send({
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        from: this.id,
        to: 'swarm-manager',
        type: MessageType.STATUS_UPDATE,
        content: {
          event: 'task:completed',
          taskId: task.id,
          agentId: this.id,
          role: this.role,
          result: result,
          duration: duration
        },
        timestamp: new Date()
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - taskStartTime;
      swarmLogger.error(`Agent-${this.id}`, 'Task processing failed', { 
        taskId: task.id, 
        duration, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      this.setStatus(AgentStatus.ERROR);
      this.isProcessing = false;
      throw error;
    }
  }

  /**
   * Format a task into a prompt for the Gemini CLI
   */
  private formatTaskPrompt(task: SwarmTask): string {
    const config = this.config as GeminiAgentConfig;
    let prompt = '';
    
    // Add system prompt first
    if (config.systemPrompt) {
      prompt += `${config.systemPrompt}\n\n---\n\n`;
    }
    
    prompt += `[TASK ID: ${task.id}]\n`;
    prompt += `[PRIORITY: ${task.priority}]\n`;
    prompt += `[TYPE: ${task.type}]\n\n`;
    prompt += `Task Description:\n${task.description}\n\n`;

    // Add any additional context from metadata
    if ((task as any).context) {
      prompt += `Context:\n${(task as any).context}\n\n`;
    }

    if (task.dependencies && task.dependencies.length > 0) {
      prompt += `Dependencies: ${task.dependencies.join(', ')}\n\n`;
    }

    prompt += `Please complete this task and respond with a structured result.`;
    
    return prompt;
  }

  /**
   * Send a message to the Gemini CLI process
   */
  private sendToProcess(message: AgentMessage): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('Cannot send to process: stdin not available');
    }

    const messageStr = JSON.stringify(message) + '\n';
    this.process.stdin.write(messageStr);
  }

  /**
   * Wait for a response to a specific task
   */
  private async waitForTaskResponse(taskId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseEmitter.off(`task:${taskId}`);
        reject(new Error(`Task ${taskId} timed out`));
      }, this.config.timeout || 300000); // 5 minute default

      this.responseEmitter.once(`task:${taskId}`, (response: any) => {
        clearTimeout(timeout);
        if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    if (code === 0) {
      this.setStatus(AgentStatus.IDLE);
    } else {
      this.setStatus(AgentStatus.ERROR);
      this.emit('agent:crashed', { code, signal });
    }

    // Clear any pending responses
    this.responseEmitter.removeAllListeners();
  }

  /**
   * Terminate the agent process
   */
  async terminate(): Promise<void> {
    if (this.process && !this.process.killed) {
      // Send graceful shutdown message
      try {
        this.sendToProcess({
          type: 'STATUS',
          content: { command: 'shutdown' },
          timestamp: new Date()
        });

        // Give it time to shut down gracefully
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        // Process might already be closing
      }

      // Force kill if still running
      if (!this.process.killed) {
        this.process.kill('SIGTERM');
      }
    }

    // Clean up
    this.responseEmitter.removeAllListeners();
    this.setStatus(AgentStatus.IDLE);
  }

  /**
   * Check if agent can handle a specific task
   */
  canHandleTask(task: SwarmTask): boolean {
    // Let the system prompt and Gemini decide what it can handle
    // For now, return true and let the agent figure it out
    return true;
  }

  /**
   * Handle incoming swarm messages
   */
  protected async handleMessage(message: SwarmMessage): Promise<void> {
    switch (message.type) {
      case MessageType.TASK_ASSIGNMENT:
        const { task } = message.content;
        await this.processTask(task);
        break;
        
      case MessageType.QUERY:
        // Handle queries by forwarding to the Gemini process
        this.sendToProcess({
          type: 'TASK',
          taskId: `query-${Date.now()}`,
          content: message.content,
          timestamp: new Date()
        });
        break;
        
      default:
        swarmLogger.warn(`Agent-${this.id}`, `Unhandled message type: ${message.type}`, { message });
    }
  }

  /**
   * Create a specialized Gemini agent for a specific role
   */
  static createForRole(role: AgentRole, messageBus: MessageBus): GeminiAgentProcess {
    const roleConfigs: Record<AgentRole, Partial<GeminiAgentConfig>> = {
      [AgentRole.ARCHITECT]: {
        name: 'System Architect',
        systemPrompt: `You are a system architect in a multi-agent swarm. Your role is to:
- Analyze requirements and create high-level system designs
- Define APIs, data models, and system architecture
- Create technical specifications for other agents
- Focus on scalability, maintainability, and best practices
When given a task, provide detailed architectural designs and specifications.`,
        model: 'gemini-1.5-pro',
        temperature: 0.7,
      },
      [AgentRole.DEVELOPER]: {
        name: 'Code Developer',
        systemPrompt: `You are a developer in a multi-agent swarm. Your role is to:
- Implement features based on architectural specifications
- Write clean, well-documented, and tested code
- Follow coding best practices and design patterns
- Handle refactoring and code optimization tasks
When given a task, provide actual implementation code with explanations.`,
        model: 'gemini-1.5-flash',
        temperature: 0.3,
      },
      [AgentRole.TESTER]: {
        name: 'QA Engineer',
        systemPrompt: `You are a QA engineer in a multi-agent swarm. Your role is to:
- Create comprehensive test suites for implementations
- Design test cases covering edge cases and error scenarios
- Write unit tests, integration tests, and E2E tests
- Ensure code quality and test coverage
When given a task, provide test implementations and test strategies.`,
        model: 'gemini-1.5-flash',
        temperature: 0.2,
      },
      [AgentRole.ORCHESTRATOR]: {
        name: 'Task Orchestrator',
        systemPrompt: `You are the orchestrator in a multi-agent swarm. Your role is to:
- Break down complex tasks into subtasks
- Assign tasks to appropriate specialist agents
- Coordinate work between multiple agents
- Track progress and manage dependencies
When given a task, analyze it and create a detailed execution plan.`,
        model: 'gemini-1.5-pro',
        temperature: 0.5,
      },
      [AgentRole.REVIEWER]: {
        name: 'Code Reviewer',
        systemPrompt: `You are a code reviewer in a multi-agent swarm. Your role is to:
- Review code for quality, security, and best practices
- Provide constructive feedback and suggestions
- Ensure code meets project standards
- Identify potential bugs and improvements
When given a task, provide thorough code review feedback.`,
        model: 'gemini-1.5-flash',
        temperature: 0.4,
      },
      [AgentRole.SPECIALIST]: {
        name: 'Domain Specialist',
        systemPrompt: `You are a specialist in a multi-agent swarm. Your role is to:
- Provide expertise in specific technical domains
- Solve complex, specialized problems
- Advise on best practices in your area of expertise
- Support other agents with specialized knowledge
When given a task, apply your specialized knowledge to provide solutions.`,
        model: 'gemini-1.5-pro',
        temperature: 0.6,
      },
    };

    const roleConfig = roleConfigs[role];
    const config: GeminiAgentConfig = {
      role,
      capabilities: [],
      systemPrompt: roleConfig.systemPrompt || '',
      name: roleConfig.name || `${role} Agent`,
      model: roleConfig.model,
      temperature: roleConfig.temperature,
    };

    return new GeminiAgentProcess(messageBus, config);
  }
}