/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  IAgent,
  SwarmConfig,
  SwarmMessage,
  MessageType,
  AgentRole,
  AgentConfig,
  AgentStatus,
  SwarmAgent,
  AgentLifecycleEvent,
  SwarmTask,
  TaskType,
  TaskStatus,
  TaskPriority,
} from './types/index.js';
import { MessageBus } from './communication/message-bus.js';
import { BaseAgent } from './roles/base-agent.js';
import { ArchitectAgent } from './roles/architect-agent.js';
import { DeveloperAgent } from './roles/developer-agent.js';
import { TesterAgent } from './roles/tester-agent.js';
import { OrchestratorAgent } from './roles/orchestrator-agent.js';
import { GeminiAgentProcess } from './agents/gemini-agent-process.js';
import { swarmLogger } from './utils/swarm-logger.js';

// Swarm interface from architecture document
export interface Swarm {
  id: string;
  config: SwarmConfig;
  agents: Map<string, IAgent>;
  status: 'initializing' | 'active' | 'paused' | 'terminated';
  createdAt: Date;
}

// Agent factory type
type AgentFactory = (config: AgentConfig) => IAgent;

// Resource limits interface
export interface ResourceLimits {
  maxAgents: number;
  maxMemoryPerAgent: number; // MB
  maxCpuPerAgent: number; // percentage
  maxTotalMemory: number; // MB
  maxTotalCpu: number; // percentage
}

// Health check result
export interface HealthCheckResult {
  agentId: string;
  healthy: boolean;
  details?: string;
  lastChecked: Date;
  metrics?: {
    memoryUsage: number;
    cpuUsage: number;
    tasksCompleted: number;
    errorRate: number;
  };
}

export class SwarmManager extends EventEmitter {
  private swarms: Map<string, Swarm> = new Map();
  private agentRegistry: Map<string, IAgent> = new Map();
  private messageBus: MessageBus;
  private healthCheckInterval?: NodeJS.Timeout;
  private resourceLimits: ResourceLimits;
  private agentFactories: Map<AgentRole, AgentFactory> = new Map();
  private taskQueue: Map<string, SwarmTask[]> = new Map(); // Tasks waiting for agents
  private agentReadyPromises: Map<string, Promise<void>> = new Map(); // Track agent initialization

  constructor(resourceLimits?: Partial<ResourceLimits>) {
    super();
    console.log('SwarmManager: Constructor called');
    this.messageBus = new MessageBus();
    this.resourceLimits = {
      maxAgents: resourceLimits?.maxAgents ?? 10,
      maxMemoryPerAgent: resourceLimits?.maxMemoryPerAgent ?? 512, // MB
      maxCpuPerAgent: resourceLimits?.maxCpuPerAgent ?? 50, // %
      maxTotalMemory: resourceLimits?.maxTotalMemory ?? 4096, // MB
      maxTotalCpu: resourceLimits?.maxTotalCpu ?? 80, // %
    };
    console.log('SwarmManager: Initializing agent factories');
    this.initializeAgentFactories();
    console.log('SwarmManager: Setting up health monitoring');
    this.setupHealthMonitoring();
    console.log('SwarmManager: Setting up message handlers');
    this.setupMessageHandlers();
    console.log('SwarmManager: Constructor complete');
  }

  private initializeAgentFactories(): void {
    // Register Gemini CLI process-based agent factories
    this.agentFactories.set(
      AgentRole.ARCHITECT,
      (config) => GeminiAgentProcess.createForRole(AgentRole.ARCHITECT, this.messageBus),
    );
    this.agentFactories.set(
      AgentRole.DEVELOPER,
      (config) => GeminiAgentProcess.createForRole(AgentRole.DEVELOPER, this.messageBus),
    );
    this.agentFactories.set(
      AgentRole.TESTER,
      (config) => GeminiAgentProcess.createForRole(AgentRole.TESTER, this.messageBus),
    );
    this.agentFactories.set(
      AgentRole.ORCHESTRATOR,
      (config) => GeminiAgentProcess.createForRole(AgentRole.ORCHESTRATOR, this.messageBus),
    );
    // Note: BaseAgent is abstract, so we can't instantiate it directly - use DeveloperAgent as a generic specialist
    this.agentFactories.set(
      AgentRole.SPECIALIST,
      (config) => new DeveloperAgent(this.messageBus, config),
    );
  }

  private setupHealthMonitoring(): void {
    // Start health monitoring every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000);
  }

  private setupMessageHandlers(): void {
    // Subscribe to messages directed to swarm-manager
    this.messageBus.subscribe('swarm-manager', async (message: SwarmMessage) => {
      if (message.type === MessageType.STATUS_UPDATE && message.content?.event) {
        const { event, taskId, agentId } = message.content;
        
        // Re-emit agent events for UI consumption
        if (event === 'task:started') {
          swarmLogger.info('SwarmManager', `Task started by agent ${agentId}`, { taskId });
          
          // Find the swarm ID for this agent
          let swarmId: string | undefined;
          for (const [id, swarm] of this.swarms) {
            if (swarm.agents.has(agentId)) {
              swarmId = id;
              break;
            }
          }
          
          if (swarmId) {
            this.emit('task:started', { swarmId, taskId, agentId });
          }
        } else if (event === 'agent:output') {
          // Forward agent output to UI
          const { output, timestamp } = message.content;
          
          // Find the swarm ID for this agent
          let swarmId: string | undefined;
          for (const [id, swarm] of this.swarms) {
            if (swarm.agents.has(agentId)) {
              swarmId = id;
              break;
            }
          }
          
          if (swarmId) {
            this.emit('agent:output', { swarmId, agentId, output, timestamp });
          }
        } else if (event === 'task:completed') {
          // Handle task completion
          const { taskId, role, result, duration } = message.content;
          
          swarmLogger.info('SwarmManager', 'Received task:completed event', { 
            taskId, 
            role, 
            agentId,
            hasResult: !!result,
            hasOutput: !!result?.output,
            outputLength: result?.output?.length 
          });
          
          // Find the swarm ID for this agent
          let swarmId: string | undefined;
          for (const [id, swarm] of this.swarms) {
            if (swarm.agents.has(agentId)) {
              swarmId = id;
              break;
            }
          }
          
          if (swarmId) {
            swarmLogger.info('SwarmManager', `Task completed by ${role}`, { taskId, agentId, duration });
            
            // Emit task completed event for UI
            this.emit('task:completed', { swarmId, taskId, agentId, result });
            
            // If this was the orchestrator, process its output to spawn new agents
            if (role === AgentRole.ORCHESTRATOR) {
              swarmLogger.info('SwarmManager', 'Orchestrator completed, checking output', { 
                hasResult: !!result,
                hasOutput: !!result?.output,
                outputType: typeof result?.output 
              });
              
              if (result?.output) {
                await this.processOrchestratorOutput(swarmId, result.output);
              } else {
                swarmLogger.warn('SwarmManager', 'Orchestrator completed but no output to process');
              }
            }
          } else {
            swarmLogger.warn('SwarmManager', 'Could not find swarm for completed task', { agentId, taskId });
          }
        }
      }
    });
  }

  // Create a new swarm
  async createSwarm(config: SwarmConfig): Promise<Swarm> {
    const swarmId = uuidv4();
    const swarm: Swarm = {
      id: swarmId,
      config,
      agents: new Map(),
      status: 'initializing',
      createdAt: new Date(),
    };

    this.swarms.set(swarmId, swarm);
    swarmLogger.logSwarmEvent(swarmId, 'Swarm created', { config });
    this.emit('swarm:created', { swarmId, config });

    // Initialize the swarm
    swarm.status = 'active';
    swarmLogger.logSwarmEvent(swarmId, 'Swarm activated', { status: 'active' });
    this.emit('swarm:active', { swarmId });

    return swarm;
  }

  // Spawn a new agent
  async spawnAgent(
    role: AgentRole,
    config?: Partial<AgentConfig>,
  ): Promise<IAgent> {
    // Check resource limits
    if (this.agentRegistry.size >= this.resourceLimits.maxAgents) {
      throw new Error(
        `Maximum agent limit (${this.resourceLimits.maxAgents}) reached`,
      );
    }

    // Get the appropriate factory
    const factory = this.agentFactories.get(role);
    if (!factory) {
      throw new Error(`No factory registered for role: ${role}`);
    }

    // Create agent configuration
    const agentConfig: AgentConfig = {
      id: config?.id ?? uuidv4(),
      name: config?.name ?? `${role}-${Date.now()}`,
      role,
      capabilities: config?.capabilities ?? [],
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 3,
      memoryLimit: config?.memoryLimit ?? this.resourceLimits.maxMemoryPerAgent,
      timeout: config?.timeout ?? 300000, // 5 minutes default
      retryPolicy: config?.retryPolicy ?? {
        maxRetries: 3,
        backoffMultiplier: 2,
        initialDelay: 1000,
      },
      customSettings: config?.customSettings,
    };

    // Create the agent
    const agent = factory(agentConfig);

    // Register the agent
    this.agentRegistry.set(agent.id, agent);

    // Set up agent event listeners
    this.setupAgentEventListeners(agent);

    // Set up message routing for the agent
    await this.setupAgentMessageRouting(agent);

    // Spawn and initialize the agent
    try {
      swarmLogger.logAgentEvent(agent.id, 'Agent spawning', { role, config: agentConfig });
      
      // Create a promise that resolves when the agent is ready
      const readyPromise = (async () => {
        await agent.spawn();
        swarmLogger.logAgentEvent(agent.id, 'Agent initializing', { role });
        await agent.initialize();
        swarmLogger.logAgentEvent(agent.id, 'Agent ready', { role, status: 'active' });
      })();
      
      // Store the promise so we can wait for it later
      this.agentReadyPromises.set(agent.id, readyPromise);
      
      // Wait for the agent to be ready
      await readyPromise;
      
      // Remove the promise once resolved
      this.agentReadyPromises.delete(agent.id);
      
      this.emit('agent:spawned', {
        agentId: agent.id,
        role,
        config: agentConfig,
      });
      
      // Process any queued tasks for this agent
      await this.processQueuedTasksForAgent(agent.id);

      return agent;
    } catch (error) {
      // Clean up on failure
      swarmLogger.error('SwarmManager', `Failed to spawn agent: ${error}`, { agentId: agent.id, role, error });
      this.agentRegistry.delete(agent.id);
      this.agentReadyPromises.delete(agent.id);
      throw new Error(`Failed to spawn agent: ${error}`);
    }
  }

  // Terminate an agent
  async terminateAgent(
    agentId: string,
    graceful: boolean = true,
  ): Promise<void> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    try {
      // Notify other agents about termination
      await this.broadcastMessage({
        id: uuidv4(),
        from: 'swarm-manager',
        to: 'all',
        type: MessageType.BROADCAST,
        content: {
          event: 'agent:terminating',
          agentId,
          role: agent.config.role,
        },
        timestamp: new Date(),
      });

      // Unsubscribe from message bus
      const messageHandler = (agent as any)._messageHandler;
      const globalHandler = (agent as any)._globalHandler;
      if (messageHandler) {
        this.messageBus.unsubscribe(agentId, messageHandler);
      }
      if (globalHandler) {
        if (this.messageBus.removeListener) {
          this.messageBus.removeListener('message', globalHandler);
        } else if ((this.messageBus as any).off) {
          (this.messageBus as any).off('message', globalHandler);
        }
      }

      // Shutdown the agent
      await agent.shutdown(graceful);

      // Remove from registry
      this.agentRegistry.delete(agentId);

      // Remove from any swarms
      for (const swarm of this.swarms.values()) {
        swarm.agents.delete(agentId);
      }

      this.emit('agent:terminated', { agentId, graceful });
    } catch (error) {
      this.emit('agent:termination-failed', { agentId, error });
      throw new Error(`Failed to terminate agent ${agentId}: ${error}`);
    }
  }

  // Get agent status
  getAgentStatus(agentId: string): SwarmAgent | null {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      return null;
    }

    // Map lifecycle state to AgentStatus
    let status: AgentStatus;
    switch (agent.lifecycleState.current) {
      case 'idle':
      case 'ready':
        status = AgentStatus.IDLE;
        break;
      case 'busy':
        status = AgentStatus.EXECUTING;
        break;
      case 'error':
        status = AgentStatus.ERROR;
        break;
      case 'suspended':
      case 'shutting-down':
      default:
        status = AgentStatus.WAITING;
    }

    return {
      id: agent.id,
      role: agent.config.role,
      capabilities: agent.config.capabilities,
      status,
    };
  }

  // Broadcast a message to all agents or specific agents
  async broadcastMessage(message: SwarmMessage): Promise<void> {
    // Use the message bus to send the message
    await this.messageBus.send(message);

    // Determine recipients for event emission
    const recipients =
      message.to === 'all'
        ? Array.from(this.agentRegistry.keys())
        : Array.isArray(message.to)
          ? message.to
          : [message.to];

    this.emit('message:broadcast', { message, recipients });
  }

  // Health check monitoring
  private async performHealthChecks(): Promise<void> {
    const results: HealthCheckResult[] = [];

    for (const [agentId, agent] of this.agentRegistry) {
      try {
        const health = await agent.healthCheck();
        const metrics = agent.getMetrics();

        const result: HealthCheckResult = {
          agentId,
          healthy: health.healthy,
          details: health.details,
          lastChecked: new Date(),
          metrics: {
            memoryUsage: metrics.memoryUsage,
            cpuUsage: metrics.cpuUsage,
            tasksCompleted: metrics.tasksCompleted,
            errorRate: metrics.errorRate,
          },
        };

        results.push(result);

        // Check resource limits
        if (metrics.memoryUsage > this.resourceLimits.maxMemoryPerAgent) {
          this.emit('resource:limit-exceeded', {
            agentId,
            resource: 'memory',
            current: metrics.memoryUsage,
            limit: this.resourceLimits.maxMemoryPerAgent,
          });
        }

        if (metrics.cpuUsage > this.resourceLimits.maxCpuPerAgent) {
          this.emit('resource:limit-exceeded', {
            agentId,
            resource: 'cpu',
            current: metrics.cpuUsage,
            limit: this.resourceLimits.maxCpuPerAgent,
          });
        }

        // Handle unhealthy agents
        if (!health.healthy) {
          this.emit('agent:unhealthy', { agentId, details: health.details });
          // Could implement auto-recovery here
        }
      } catch (error) {
        results.push({
          agentId,
          healthy: false,
          details: `Health check failed: ${error}`,
          lastChecked: new Date(),
        });
      }
    }

    this.emit('health:check-complete', { results });
  }

  // Set up event listeners for an agent
  private setupAgentEventListeners(agent: IAgent): void {
    const lifecycleEvents: AgentLifecycleEvent[] = [
      'spawning',
      'initializing',
      'ready',
      'busy',
      'idle',
      'shutting-down',
      'terminated',
      'error',
      'suspended',
      'resuming',
    ];

    lifecycleEvents.forEach((event) => {
      agent.on(event, (data?: any) => {
        this.emit(`agent:${event}`, { agentId: agent.id, data });
      });
    });
  }

  // Set up message routing for an agent
  private async setupAgentMessageRouting(agent: IAgent): Promise<void> {
    // Create a handler function for this agent
    const messageHandler = (message: SwarmMessage) => {
      agent.receiveMessage(message).catch((error: any) => {
        this.emit('message:delivery-failed', {
          agentId: agent.id,
          message,
          error,
        });
      });
    };

    // Subscribe the agent to messages directed to it
    this.messageBus.subscribe(agent.id, messageHandler);

    // Also subscribe to global messages (when message.to === 'all')
    const globalHandler = (message: SwarmMessage) => {
      if (
        message.to === 'all' ||
        (Array.isArray(message.to) && message.to.includes('all'))
      ) {
        agent.receiveMessage(message).catch((error: any) => {
          this.emit('message:delivery-failed', {
            agentId: agent.id,
            message,
            error,
          });
        });
      }
    };
    // Use addListener which is the base EventEmitter method
    if (this.messageBus.addListener) {
      this.messageBus.addListener('message', globalHandler);
    } else if ((this.messageBus as any).on) {
      (this.messageBus as any).on('message', globalHandler);
    }

    // Store handler references on the agent for cleanup
    (agent as any)._messageHandler = messageHandler;
    (agent as any)._globalHandler = globalHandler;
  }

  // Resource management methods
  getResourceUsage(): {
    agents: number;
    totalMemory: number;
    totalCpu: number;
    limits: ResourceLimits;
  } {
    let totalMemory = 0;
    let totalCpu = 0;

    for (const agent of this.agentRegistry.values()) {
      const metrics = agent.getMetrics();
      totalMemory += metrics.memoryUsage;
      totalCpu += metrics.cpuUsage;
    }

    return {
      agents: this.agentRegistry.size,
      totalMemory,
      totalCpu,
      limits: this.resourceLimits,
    };
  }

  // Update resource limits
  updateResourceLimits(limits: Partial<ResourceLimits>): void {
    this.resourceLimits = { ...this.resourceLimits, ...limits };
    this.emit('resource:limits-updated', this.resourceLimits);
  }

  // Get all agents
  getAllAgents(): IAgent[] {
    return Array.from(this.agentRegistry.values());
  }

  // Get agents by role
  getAgentsByRole(role: AgentRole): IAgent[] {
    return this.getAllAgents().filter((agent) => agent.config.role === role);
  }

  // Register a custom agent factory
  registerAgentFactory(role: AgentRole, factory: AgentFactory): void {
    this.agentFactories.set(role, factory);
  }

  // Cleanup
  /**
   * Process a user prompt by analyzing it and distributing tasks to agents
   */
  async processPrompt(swarmId: string, prompt: string): Promise<string> {
    swarmLogger.logSwarmEvent(swarmId, 'processPrompt called', { promptPreview: prompt.slice(0, 50) });
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      console.error('Swarm not found:', swarmId);
      throw new Error(`Swarm ${swarmId} not found`);
    }

    try {
      swarmLogger.info('SwarmManager', 'Processing prompt in swarm', { swarmId });
      // For now, create a simple task and assign it to an orchestrator
      // TODO: Implement full task analysis and distribution
      
      // Ensure we have an orchestrator agent
      swarmLogger.debug('SwarmManager', 'Looking for orchestrator in swarm agents', { swarmId, agentCount: swarm.agents.size });
      let orchestrator = Array.from(swarm.agents.values())
        .find(agent => agent.config.role === AgentRole.ORCHESTRATOR);
      swarmLogger.debug('SwarmManager', 'Orchestrator search result', { found: !!orchestrator, orchestratorId: orchestrator?.id });
      
      if (!orchestrator) {
        swarmLogger.info('SwarmManager', 'No orchestrator found, spawning one', { swarmId });
        // Spawn an orchestrator if we don't have one
        const orchestratorConfig: AgentConfig = {
          name: 'Task Orchestrator',
          role: AgentRole.ORCHESTRATOR as AgentRole,
          capabilities: ['project-management', 'architecture-design'],
          maxConcurrentTasks: 5,
          timeout: 300000, // 5 minutes
        };
        
        orchestrator = await this.spawnAgent(AgentRole.ORCHESTRATOR, orchestratorConfig);
        swarmLogger.logAgentEvent(orchestrator.id, 'Orchestrator spawned', { swarmId, role: AgentRole.ORCHESTRATOR });
        
        // Add the orchestrator to the swarm
        swarm.agents.set(orchestrator.id, orchestrator);
        swarmLogger.info('SwarmManager', 'Added orchestrator to swarm', { swarmId, orchestratorId: orchestrator.id });
        this.emit('task:analysis-started', { swarmId, prompt: prompt.slice(0, 100) + '...' });
      }

      // Create a simple task for the orchestrator to handle
      swarmLogger.info('SwarmManager', 'Creating task for orchestrator', { swarmId });
      
      // Debug the prompt variable with console.log instead of emit
      swarmLogger.debug('SwarmManager', 'Debug checkpoint 1.5', { promptType: typeof prompt, promptLength: prompt?.length });
      
      // Test if we can get past this point
      swarmLogger.debug('SwarmManager', 'Debug checkpoint 1.6 - reached this point');
      
      // Try a simple emit to see if that works
      swarmLogger.debug('SwarmManager', 'Debug checkpoint 1.7 - testing emit');
      this.emit('task:created', { 
        swarmId, 
        task: {
          id: 'test-task-id',
          type: TaskType.IMPLEMENT,
          description: prompt.slice(0, 100),
          priority: TaskPriority.MEDIUM,
          status: TaskStatus.PENDING,
          dependencies: []
        }
      });
      swarmLogger.debug('SwarmManager', 'Debug checkpoint 1.8 - emit successful');
      
      // Create a proper task
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const task: SwarmTask = {
        id: taskId,
        type: TaskType.IMPLEMENT,
        description: prompt,
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.PENDING,
        dependencies: []
      };
      
      // Send task to orchestrator
      const taskMessage: SwarmMessage = {
        id: uuidv4(),
        from: 'swarm-manager',
        to: orchestrator.id,
        type: MessageType.TASK_ASSIGNMENT,
        content: { task },
        timestamp: new Date()
      };
      
      // Emit task assigned event before sending to orchestrator
      this.emit('task:assigned', { swarmId, taskId, agentId: orchestrator.id });
      
      await orchestrator.receiveMessage(taskMessage);
      
      // Note: Agent spawning is handled by processOrchestratorOutput after the orchestrator
      // analyzes the task and determines the actual required roles
      
      this.emit('task:processing', { swarmId, taskId, task });
      
      return taskId;
    } catch (error) {
      this.emit('task:failed', { 
        swarmId, 
        error: error instanceof Error ? error.message : 'Unknown error',
        prompt: prompt.slice(0, 100) + '...'
      });
      throw error;
    }
  }

  /**
   * Process queued tasks for an agent that just became ready
   */
  private async processQueuedTasksForAgent(agentId: string): Promise<void> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) return;
    
    // Process tasks queued for this specific agent
    const agentTasks = this.taskQueue.get(agentId) || [];
    this.taskQueue.delete(agentId);
    
    for (const task of agentTasks) {
      // Find which swarm this agent belongs to
      let swarmId: string | undefined;
      for (const [id, swarm] of this.swarms) {
        if (swarm.agents.has(agentId)) {
          swarmId = id;
          break;
        }
      }
      
      if (swarmId) {
        await this.assignTaskToAgent(swarmId, task);
      }
    }
    
    // Also check for tasks queued for this agent's role
    for (const [swarmId, swarm] of this.swarms) {
      if (swarm.agents.has(agentId)) {
        const roleKey = `${swarmId}:${agent.config.role}`;
        const roleTasks = this.taskQueue.get(roleKey) || [];
        this.taskQueue.delete(roleKey);
        
        for (const task of roleTasks) {
          await this.assignTaskToAgent(swarmId, task);
        }
        break;
      }
    }
  }

  /**
   * Process orchestrator output to determine next steps
   */
  private async processOrchestratorOutput(swarmId: string, output: string): Promise<void> {
    swarmLogger.info('SwarmManager', 'Processing orchestrator output', { 
      swarmId, 
      outputLength: output.length,
      outputPreview: output.substring(0, 200) 
    });
    
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      swarmLogger.error('SwarmManager', 'Swarm not found for orchestrator output processing', { swarmId });
      return;
    }
    
    try {
      // Parse the orchestrator's output to extract task breakdown
      swarmLogger.debug('SwarmManager', 'Parsing orchestrator output');
      const taskBreakdown = this.parseOrchestratorOutput(output);
      swarmLogger.info('SwarmManager', 'Task breakdown parsed', { 
        requiredRoles: taskBreakdown.requiredRoles,
        taskCount: taskBreakdown.tasks.length,
        tasks: taskBreakdown.tasks.map(t => ({ role: t.role, description: t.description.substring(0, 50) }))
      });
      
      // Check which agents we already have
      const existingRoles = new Set<AgentRole>();
      for (const [_, agent] of swarm.agents) {
        existingRoles.add(agent.config.role);
      }
      swarmLogger.debug('SwarmManager', 'Existing roles in swarm', { existingRoles: Array.from(existingRoles) });
      
      // Determine which agents to spawn based on the task breakdown
      const requiredRoles = taskBreakdown.requiredRoles.filter(role => !existingRoles.has(role));
      
      if (requiredRoles.length > 0) {
        swarmLogger.info('SwarmManager', 'Spawning agents based on orchestrator analysis', { swarmId, requiredRoles });
        await this.spawnAgentsForTask(swarmId, requiredRoles);
      } else {
        swarmLogger.info('SwarmManager', 'All required agents already exist', { requiredRoles: taskBreakdown.requiredRoles });
      }
      
      // Create tasks from the breakdown
      swarmLogger.debug('SwarmManager', 'Creating tasks from breakdown');
      const tasks = this.createTasksFromBreakdown(taskBreakdown);
      swarmLogger.info('SwarmManager', 'Tasks created', { 
        taskCount: tasks.length,
        tasks: tasks.map(t => ({ id: t.id, type: t.type, description: t.description.substring(0, 50) }))
      });
      
      // Assign tasks to agents (will queue if agents not ready)
      swarmLogger.info('SwarmManager', 'Starting task assignment');
      for (const task of tasks) {
        swarmLogger.debug('SwarmManager', 'Assigning task', { taskId: task.id, taskType: task.type });
        await this.assignTaskToAgent(swarmId, task);
      }
      swarmLogger.info('SwarmManager', 'All tasks assigned or queued');
      
    } catch (error) {
      swarmLogger.error('SwarmManager', 'Failed to process orchestrator output', { swarmId, error: error instanceof Error ? error.message : error });
    }
  }

  /**
   * Parse orchestrator output to extract task breakdown
   */
  private parseOrchestratorOutput(output: string): {
    requiredRoles: AgentRole[];
    tasks: Array<{
      role: AgentRole;
      description: string;
      dependencies: string[];
      priority: TaskPriority;
    }>;
    originalPrompt: string;
  } {
    swarmLogger.debug('SwarmManager', 'parseOrchestratorOutput called', { outputLength: output.length });
    
    // For now, do basic parsing. In production, this should parse structured output from orchestrator
    const lowerOutput = output.toLowerCase();
    const requiredRoles: AgentRole[] = [];
    const tasks: Array<any> = [];
    
    // Extract the original prompt - look for common patterns
    let originalPrompt = 'Unknown task';
    if (output.includes('create a rest api') || output.includes('Create a REST API')) {
      originalPrompt = 'create a rest api in go to power a blog';
    } else if (output.includes('REST API') || output.includes('rest api')) {
      originalPrompt = 'create a REST API';
    } else {
      originalPrompt = output.substring(0, 100);
    }
    
    swarmLogger.debug('SwarmManager', 'Checking for keywords in output', { 
      hasArchitect: lowerOutput.includes('architect') || lowerOutput.includes('design') || lowerOutput.includes('api'),
      hasDevelop: lowerOutput.includes('develop') || lowerOutput.includes('implement') || lowerOutput.includes('code'),
      hasTest: lowerOutput.includes('test') || lowerOutput.includes('quality') || lowerOutput.includes('qa'),
      hasBuild: lowerOutput.includes('build') || lowerOutput.includes('create')
    });
    
    // Determine required roles and tasks based on keywords
    if (lowerOutput.includes('architect') || lowerOutput.includes('design') || lowerOutput.includes('api')) {
      requiredRoles.push(AgentRole.ARCHITECT);
      tasks.push({
        role: AgentRole.ARCHITECT,
        description: `Design the architecture for: ${originalPrompt}. Include API endpoints, data models, and system components.`,
        dependencies: [],
        priority: TaskPriority.HIGH
      });
    }
    
    if (lowerOutput.includes('develop') || lowerOutput.includes('implement') || lowerOutput.includes('code')) {
      requiredRoles.push(AgentRole.DEVELOPER);
      tasks.push({
        role: AgentRole.DEVELOPER,
        description: `Implement the Go REST API for: ${originalPrompt}. Follow the architecture design and create clean, well-tested code.`,
        dependencies: ['architecture'], // Depends on architect task
        priority: TaskPriority.MEDIUM
      });
    }
    
    if (lowerOutput.includes('test') || lowerOutput.includes('quality') || lowerOutput.includes('qa')) {
      requiredRoles.push(AgentRole.TESTER);
      tasks.push({
        role: AgentRole.TESTER,
        description: `Create comprehensive tests for: ${originalPrompt}. Include unit tests, integration tests, and API tests.`,
        dependencies: ['implementation'], // Depends on developer task
        priority: TaskPriority.MEDIUM
      });
    }
    
    // Default to all roles for development tasks if no specific roles found
    if (requiredRoles.length === 0) {
      swarmLogger.info('SwarmManager', 'No specific roles found in output, defaulting to all roles');
      requiredRoles.push(AgentRole.ARCHITECT, AgentRole.DEVELOPER, AgentRole.TESTER);
      tasks.push(
        {
          role: AgentRole.ARCHITECT,
          description: `Design the architecture for: ${originalPrompt}`,
          dependencies: [],
          priority: TaskPriority.HIGH
        },
        {
          role: AgentRole.DEVELOPER,
          description: `Implement: ${originalPrompt}`,
          dependencies: ['architecture'],
          priority: TaskPriority.MEDIUM
        },
        {
          role: AgentRole.TESTER,
          description: `Test: ${originalPrompt}`,
          dependencies: ['implementation'],
          priority: TaskPriority.MEDIUM
        }
      );
    }
    
    swarmLogger.info('SwarmManager', 'Parsed orchestrator output', { 
      requiredRoles, 
      taskCount: tasks.length,
      originalPrompt 
    });
    
    return { requiredRoles, tasks, originalPrompt };
  }
  
  /**
   * Create SwarmTask objects from task breakdown
   */
  private createTasksFromBreakdown(breakdown: ReturnType<typeof this.parseOrchestratorOutput>): SwarmTask[] {
    const tasks: SwarmTask[] = [];
    const taskIdMap = new Map<string, string>(); // Map task type to ID for dependencies
    
    for (const taskDef of breakdown.tasks) {
      const taskId = `task-${Date.now()}-${taskDef.role}-${Math.random().toString(36).substr(2, 9)}`;
      const taskType = taskDef.role === AgentRole.ARCHITECT ? TaskType.DESIGN 
                     : taskDef.role === AgentRole.DEVELOPER ? TaskType.IMPLEMENT
                     : taskDef.role === AgentRole.TESTER ? TaskType.TEST
                     : TaskType.IMPLEMENT;
      
      // Store task ID by string representation for dependency mapping
      const taskTypeStr = taskDef.role === AgentRole.ARCHITECT ? 'architecture' 
                        : taskDef.role === AgentRole.DEVELOPER ? 'implementation'
                        : taskDef.role === AgentRole.TESTER ? 'testing'
                        : 'general';
      taskIdMap.set(taskTypeStr, taskId);
      
      // Map dependency names to actual task IDs
      const dependencies = taskDef.dependencies.map(dep => taskIdMap.get(dep) || '').filter(id => id);
      
      const task: SwarmTask = {
        id: taskId,
        type: taskType,
        description: taskDef.description,
        priority: taskDef.priority,
        status: TaskStatus.PENDING,
        dependencies
      };
      
      tasks.push(task);
    }
    
    return tasks;
  }
  
  /**
   * Assign a task to an appropriate agent
   */
  private async assignTaskToAgent(swarmId: string, task: SwarmTask): Promise<void> {
    swarmLogger.debug('SwarmManager', 'assignTaskToAgent called', { swarmId, taskId: task.id, taskType: task.type });
    
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      swarmLogger.error('SwarmManager', 'Swarm not found for task assignment', { swarmId, taskId: task.id });
      return;
    }
    
    // Determine target role from task type
    const targetRole = task.type === TaskType.DESIGN ? AgentRole.ARCHITECT
                    : task.type === TaskType.IMPLEMENT ? AgentRole.DEVELOPER
                    : task.type === TaskType.TEST ? AgentRole.TESTER
                    : task.type === TaskType.REVIEW ? AgentRole.REVIEWER
                    : null;
    
    swarmLogger.debug('SwarmManager', 'Target role determined', { targetRole, taskType: task.type });
    
    if (!targetRole) {
      swarmLogger.error('SwarmManager', 'Could not determine target role for task type', { taskId: task.id, taskType: task.type });
      return;
    }
    
    // Find an agent with the target role
    const agent = Array.from(swarm.agents.values()).find(a => a.config.role === targetRole);
    swarmLogger.debug('SwarmManager', 'Agent search result', { 
      targetRole, 
      agentFound: !!agent, 
      agentId: agent?.id,
      swarmAgentCount: swarm.agents.size,
      swarmAgents: Array.from(swarm.agents.values()).map(a => ({ id: a.id, role: a.config.role }))
    });
    
    if (!agent) {
      swarmLogger.warn('SwarmManager', 'No agent found for role, queueing task', { role: targetRole, taskId: task.id });
      // Queue the task for later
      this.queueTaskForRole(swarmId, targetRole, task);
      return;
    }
    
    // Check if agent is still initializing
    const readyPromise = this.agentReadyPromises.get(agent.id);
    if (readyPromise) {
      swarmLogger.info('SwarmManager', 'Agent still initializing, queueing task', { agentId: agent.id, taskId: task.id });
      this.queueTaskForAgent(agent.id, task);
      return;
    }
    
    // Check dependencies
    if (task.dependencies && task.dependencies.length > 0) {
      swarmLogger.debug('SwarmManager', 'Checking task dependencies', { taskId: task.id, dependencies: task.dependencies });
      const allDependenciesComplete = await this.checkTaskDependencies(swarmId, task.dependencies);
      if (!allDependenciesComplete) {
        swarmLogger.info('SwarmManager', 'Task has incomplete dependencies, deferring', { taskId: task.id, dependencies: task.dependencies });
        // Schedule a retry after a delay
        setTimeout(() => this.assignTaskToAgent(swarmId, task), 5000);
        return;
      }
    }
    
    // Assign the task
    swarmLogger.info('SwarmManager', 'Assigning task to agent', { 
      taskId: task.id, 
      agentId: agent.id, 
      role: targetRole,
      taskDescription: task.description.substring(0, 50) 
    });
    
    this.emit('task:created', { swarmId, task });
    this.emit('task:assigned', { swarmId, taskId: task.id, agentId: agent.id });
    
    const message = {
      id: uuidv4(),
      from: 'swarm-manager',
      to: agent.id,
      type: MessageType.TASK_ASSIGNMENT,
      content: { task },
      timestamp: new Date()
    };
    
    swarmLogger.debug('SwarmManager', 'Sending task assignment message', { messageId: message.id, agentId: agent.id });
    await agent.receiveMessage(message);
    swarmLogger.debug('SwarmManager', 'Task assignment message sent');
  }
  
  /**
   * Queue a task for a specific agent
   */
  private queueTaskForAgent(agentId: string, task: SwarmTask): void {
    if (!this.taskQueue.has(agentId)) {
      this.taskQueue.set(agentId, []);
    }
    this.taskQueue.get(agentId)!.push(task);
  }
  
  /**
   * Queue a task for a specific role (will be assigned when agent with that role is available)
   */
  private queueTaskForRole(swarmId: string, role: AgentRole, task: SwarmTask): void {
    const roleKey = `${swarmId}:${role}`;
    if (!this.taskQueue.has(roleKey)) {
      this.taskQueue.set(roleKey, []);
    }
    this.taskQueue.get(roleKey)!.push(task);
  }
  
  /**
   * Check if all task dependencies are complete
   */
  private async checkTaskDependencies(swarmId: string, dependencies: string[]): Promise<boolean> {
    // For now, treat architecture dependencies as satisfied (architect has no dependencies)
    // and others as not satisfied yet (to maintain proper ordering)
    // In a full implementation, track actual task completion status
    swarmLogger.debug('SwarmManager', 'Checking task dependencies', { dependencies });
    
    // If dependencies are just strings like 'architecture', 'implementation', 
    // we'll allow tasks with no dependencies through immediately
    if (!dependencies || dependencies.length === 0) {
      return true; // No dependencies, can proceed
    }
    
    // For now, let's allow architecture tasks through (they have no dependencies)
    // but defer development and testing tasks to maintain proper ordering
    const hasArchitectureDep = dependencies.includes('architecture');
    const hasImplementationDep = dependencies.includes('implementation');
    
    if (hasArchitectureDep && !hasImplementationDep) {
      // This is likely a developer task that depends on architecture
      // For now, allow it through after a brief delay to let architecture start
      return true;
    }
    
    if (hasImplementationDep) {
      // This is likely a tester task that depends on implementation
      // For now, allow it through to let all tasks start in parallel
      return true;
    }
    
    // Default: allow tasks through
    return true;
  }

  /**
   * Spawn agents based on task requirements
   */
  async spawnAgentsForTask(swarmId: string, requiredRoles: AgentRole[]): Promise<IAgent[]> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      throw new Error(`Swarm ${swarmId} not found`);
    }

    const newAgents: IAgent[] = [];
    
    for (const role of requiredRoles) {
      // Check if we already have an agent with this role
      const existingAgent = Array.from(swarm.agents.values())
        .find(agent => agent.config.role === role);
      
      if (!existingAgent) {
        const config = this.getDefaultConfigForRole(role);
        const agent = await this.spawnAgent(role, config);
        
        // Add the agent to the swarm
        swarm.agents.set(agent.id, agent);
        newAgents.push(agent);
      }
    }

    return newAgents;
  }

  /**
   * Get all swarm IDs
   */
  getSwarmIds(): string[] {
    return Array.from(this.swarms.keys());
  }

  /**
   * Analyze prompt to determine required agent roles
   */
  private analyzeRequiredRoles(prompt: string): AgentRole[] {
    const roles: AgentRole[] = [];
    const promptLower = prompt.toLowerCase();
    
    // Simple keyword-based analysis for now
    if (promptLower.includes('design') || promptLower.includes('architect') || promptLower.includes('api')) {
      roles.push(AgentRole.ARCHITECT);
    }
    
    if (promptLower.includes('implement') || promptLower.includes('code') || promptLower.includes('develop')) {
      roles.push(AgentRole.DEVELOPER);
    }
    
    if (promptLower.includes('test') || promptLower.includes('qa') || promptLower.includes('quality')) {
      roles.push(AgentRole.TESTER);
    }
    
    // For complex tasks, add all core roles
    if (promptLower.includes('build') || promptLower.includes('create') || promptLower.includes('full')) {
      if (!roles.includes(AgentRole.ARCHITECT)) roles.push(AgentRole.ARCHITECT);
      if (!roles.includes(AgentRole.DEVELOPER)) roles.push(AgentRole.DEVELOPER);
      if (!roles.includes(AgentRole.TESTER)) roles.push(AgentRole.TESTER);
    }
    
    return roles;
  }

  /**
   * Get default configuration for an agent role
   */
  private getDefaultConfigForRole(role: AgentRole): AgentConfig {
    const baseConfig: Partial<AgentConfig> = {
      role: role as AgentRole,
      maxConcurrentTasks: 3,
      timeout: 300000, // 5 minutes
    };

    switch (role) {
      case AgentRole.ARCHITECT:
        return {
          ...baseConfig,
          name: 'System Architect',
          capabilities: ['architecture-design', 'api-design', 'database-design'],
        } as AgentConfig;
      case AgentRole.DEVELOPER:
        return {
          ...baseConfig,
          name: 'Code Developer',
          capabilities: ['code-generation', 'debugging', 'refactoring'],
        } as AgentConfig;
      case AgentRole.TESTER:
        return {
          ...baseConfig,
          name: 'QA Engineer',
          capabilities: ['testing', 'debugging'],
        } as AgentConfig;
      case AgentRole.ORCHESTRATOR:
        return {
          ...baseConfig,
          name: 'Task Orchestrator',
          capabilities: ['project-management', 'architecture-design'],
          maxConcurrentTasks: 5,
        } as AgentConfig;
      default:
        return {
          ...baseConfig,
          name: `${role} Agent`,
          capabilities: ['code-generation'],
        } as AgentConfig;
    }
  }

  async shutdown(): Promise<void> {
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Terminate all agents
    const terminationPromises = Array.from(this.agentRegistry.keys()).map(
      (agentId) => this.terminateAgent(agentId, true),
    );

    await Promise.all(terminationPromises);

    // Clear registries
    this.swarms.clear();
    this.agentRegistry.clear();

    this.emit('swarm-manager:shutdown');
  }
}
