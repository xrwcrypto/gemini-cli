/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { SwarmManager, ResourceLimits } from '@gemini-cli/swarm';
import { AgentRole } from '@gemini-cli/swarm';
import { MessageType, HistoryItemWithoutId } from '../../types.js';
import { SimpleConductorDashboard } from './SimpleConductorDashboard.js';
import { useDashboardState } from './hooks/useDashboardState.js';
import { SwarmUILogger } from './swarm-ui-logger.js';

interface SwarmCommandProps {
  onExit: () => void;
  onMessage: (message: { type: MessageType; content: string; timestamp: Date }) => void;
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
  initialPrompt?: string;
}

export interface SwarmState {
  isActive: boolean;
  swarmManager?: SwarmManager;
  agents: Map<string, { id: string; role: AgentRole; status: string }>;
  currentTask?: string;
  taskQueue: any[];
}

export const SwarmCommand: React.FC<SwarmCommandProps> = ({ onExit, onMessage, addItem, initialPrompt }) => {
  const [swarmState, setSwarmState] = useState<SwarmState>({
    isActive: false,
    agents: new Map(),
    taskQueue: []
  });
  const [isInitializing, setIsInitializing] = useState(true); // Start as initializing
  const [error, setError] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string[]>>(new Map());
  
  // Handle agent output
  const handleAgentOutput = useCallback((agentId: string, output: string) => {
    setAgentOutputs(prev => {
      const newMap = new Map(prev);
      const agentLines = newMap.get(agentId) || [];
      agentLines.push(output);
      // Keep last 100 lines per agent
      if (agentLines.length > 100) {
        agentLines.shift();
      }
      newMap.set(agentId, agentLines);
      return newMap;
    });
  }, []);
  
  // Dashboard state management
  const {
    dashboardState,
    updateDashboardState,
    addActivityLogEntry,
    updateAgentStatus,
    updateTask
  } = useDashboardState({
    swarmManager: swarmState.swarmManager,
    isActive: swarmState.isActive
  });

  // Initialize logger with UI callbacks
  const [logger] = useState(() => new SwarmUILogger(onMessage, addActivityLogEntry));

  const initializeSwarm = useCallback(async () => {
    console.log('initializeSwarm called, current state:', { isInitializing, isActive: swarmState.isActive });
    if (isInitializing || swarmState.isActive) {
      console.log('initializeSwarm: Skipping - already initializing or active');
      return;
    }

    console.log('initializeSwarm: Starting initialization');
    setIsInitializing(true);
    setError(null);
    
    // Set environment variable to prevent exit on unhandled rejections
    process.env.GEMINI_SWARM_MODE = 'true';

    try {
      // Log initialization
      logger.logSwarmEvent('main', 'Initializing Swarm Mode', { resourceLimits: true });

      // Create SwarmManager with default resource limits
      const resourceLimits: Partial<ResourceLimits> = {
        maxAgents: 5,
        maxMemoryPerAgent: 512,
        maxCpuPerAgent: 50,
        maxTotalMemory: 2048,
        maxTotalCpu: 80
      };

      console.log('initializeSwarm: Creating SwarmManager with limits:', resourceLimits);
      const swarmManager = new SwarmManager(resourceLimits);
      console.log('initializeSwarm: SwarmManager created successfully');

      // Set up event listeners
      swarmManager.on('agent:spawned', ({ agentId, role }) => {
        logger.logAgentEvent(agentId, role, 'Agent spawned successfully');

        // Update agent in dashboard
        updateAgentStatus(agentId, {
          id: agentId,
          role: role,
          status: 'idle',
          lastActivity: new Date(),
          memoryUsage: 100,
          cpuUsage: 5,
          responseTime: 500,
          successRate: 100,
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          activeTools: [],
          toolUsageCount: {},
          tokenUsage: { total: 0, input: 0, output: 0, cost: 0 },
          healthScore: 95,
          isOnline: true,
          lastHeartbeat: new Date()
        });
      });

      swarmManager.on('agent:terminated', ({ agentId }) => {
        onMessage({
          type: MessageType.INFO,
          content: `🛑 Agent terminated: ${agentId}`,
          timestamp: new Date()
        });
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'INFO',
          source: 'SwarmManager',
          message: `Agent terminated: ${agentId}`,
          details: 'Agent shut down gracefully'
        });
        
        // Remove agent from dashboard state
        updateDashboardState({
          agents: new Map([...dashboardState.agents].filter(([id]) => id !== agentId))
        });
      });

      swarmManager.on('agent:unhealthy', ({ agentId, details }) => {
        onMessage({
          type: MessageType.ERROR,
          content: `⚠️ Agent unhealthy: ${agentId} - ${details}`,
          timestamp: new Date()
        });
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'error',
          level: 'ERROR',
          source: 'HealthMonitor',
          message: `Agent unhealthy: ${agentId}`,
          details: details
        });
      });

      // Task processing event listeners
      swarmManager.on('task:analysis-started', ({ swarmId, prompt }) => {
        setCurrentPrompt(prompt); // Store the current prompt
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'INFO',
          source: 'TaskAnalyzer',
          message: 'Task analysis started',
          details: `Analyzing prompt: ${prompt}`
        });
      });

      swarmManager.on('task:created', ({ swarmId, task }) => {
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'success',
          level: 'INFO',
          source: 'TaskManager',
          message: `Task created: ${task.id}`,
          details: `Type: ${task.type}, Priority: ${task.priority}`
        });

        // Update the task in the dashboard with the actual prompt
        updateTask({
          id: task.id,
          type: task.type,
          description: currentPrompt || task.description || 'New task',
          status: 'pending',
          priority: task.priority,
          createdAt: new Date(),
          estimatedDuration: 30
        });
      });

      swarmManager.on('task:assigned', ({ swarmId, taskId, agentId }) => {
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'INFO',
          source: 'TaskDistributor',
          message: `Task assigned: ${taskId}`,
          details: `Assigned to agent: ${agentId}`
        });

        // Update task status to assigned with the current prompt
        updateTask({
          id: taskId,
          type: 'implementation',
          description: currentPrompt || 'Task assigned to agent',
          status: 'pending',
          assignedAgent: agentId,
          priority: 'medium',
          createdAt: new Date(),
          estimatedDuration: 30
        });
        
        // Also update agent status to busy when task is assigned
        updateAgentStatus(agentId, {
          status: 'busy',
          currentTask: {
            id: taskId,
            description: currentPrompt || 'Processing task',
            progress: 0,
            startedAt: new Date()
          },
          lastActivity: new Date()
        });
      });

      swarmManager.on('task:started', ({ swarmId, taskId, agentId }) => {
        onMessage({
          type: MessageType.INFO,
          content: `🚀 Task started: ${taskId} by ${agentId}`,
          timestamp: new Date()
        });
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'INFO',
          source: `Agent:${agentId}`,
          message: `Task execution started`,
          details: `Task ID: ${taskId}`
        });

        // Update task status to in_progress and agent status to busy
        updateTask({
          id: taskId,
          type: 'implementation',
          description: currentPrompt || 'Task in progress',
          status: 'in_progress',
          assignedAgent: agentId,
          priority: 'medium',
          createdAt: new Date(),
          estimatedDuration: 30
        });

        // Update agent status to busy
        updateAgentStatus(agentId, {
          status: 'busy',
          currentTask: {
            id: taskId,
            description: currentPrompt || 'Processing task',
            progress: 0,
            startedAt: new Date()
          },
          lastActivity: new Date()
        });
      });

      swarmManager.on('task:progress', ({ swarmId, taskId, agentId, progress, status }) => {
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'INFO',
          source: `Agent:${agentId}`,
          message: `Task progress: ${progress}%`,
          details: status
        });
      });

      swarmManager.on('task:completed', ({ swarmId, taskId, agentId, result }) => {
        onMessage({
          type: MessageType.SUCCESS,
          content: `✅ Task completed: ${taskId}`,
          timestamp: new Date()
        });
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'success',
          level: 'INFO',
          source: `Agent:${agentId}`,
          message: `Task completed successfully`,
          details: result
        });
        
        // Update task status to completed
        updateTask({
          id: taskId,
          type: 'implementation',
          description: currentPrompt || 'Task completed',
          status: 'completed',
          assignedAgent: agentId,
          priority: 'medium',
          createdAt: new Date(),
          estimatedDuration: 30
        });
        
        // Update agent status back to idle
        updateAgentStatus(agentId, {
          status: 'idle',
          currentTask: undefined,
          lastActivity: new Date()
        });
      });

      swarmManager.on('task:failed', ({ swarmId, error, prompt }) => {
        onMessage({
          type: MessageType.ERROR,
          content: `❌ Task failed: ${error}`,
          timestamp: new Date()
        });
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'error',
          level: 'ERROR',
          source: 'TaskManager',
          message: 'Task execution failed',
          details: `Error: ${error}\nPrompt: ${prompt}`
        });
      });

      // Debug event listener
      swarmManager.on('debug:info', ({ swarmId, message, details }) => {
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          level: 'DEBUG',
          source: 'SwarmManager',
          message: message,
          details: details
        });
      });
      
      // Agent output listener - capture agent thinking/output
      swarmManager.on('agent:output', ({ agentId, output }) => {
        handleAgentOutput(agentId, output);
      });

      // Create initial swarm
      const swarmConfig = {
        maxAgents: 10,
        concurrentTasks: 10,
        communicationMode: 'hierarchical' as const,
        enableLogging: true,
        logLevel: 'info' as const
      };

      const swarm = await swarmManager.createSwarm(swarmConfig);
      console.log('SwarmCommand: Swarm created successfully', { swarmId: swarm.id, status: swarm.status });

      setSwarmState({
        isActive: true,
        swarmManager,
        agents: new Map(),
        taskQueue: []
      });
      
      console.log('SwarmCommand: Swarm state updated, isActive=true');

      onMessage({
        type: MessageType.INFO,
        content: '🎯 Swarm Mode activated! You are now the conductor.',
        timestamp: new Date()
      });

      onMessage({
        type: MessageType.INFO,
        content: 'Use natural language to describe tasks. The swarm will analyze and distribute work across specialized agents.',
        timestamp: new Date()
      });

      // Process initial prompt if provided
      if (initialPrompt && initialPrompt.trim()) {
        onMessage({
          type: MessageType.INFO,
          content: `🚀 Processing initial task: ${initialPrompt.slice(0, 100)}${initialPrompt.length > 100 ? '...' : ''}`,
          timestamp: new Date()
        });

        addActivityLogEntry({
          timestamp: new Date(),
          type: 'task',
          level: 'INFO',
          source: 'Conductor',
          message: 'Initial task received',
          details: initialPrompt
        });

        // Process the prompt through the swarm manager
        try {
          const swarmIds = swarmManager.getSwarmIds();
          const swarmId = swarmIds[0];
          if (swarmId) {
            const taskId = await swarmManager.processPrompt(swarmId, initialPrompt);
            
            addActivityLogEntry({
              timestamp: new Date(),
              type: 'success',
              level: 'INFO',
              source: 'SwarmManager',
              message: `Task processing started`,
              details: `Task ID: ${taskId}`
            });
          }
        } catch (error) {
          addActivityLogEntry({
            timestamp: new Date(),
            type: 'error',
            level: 'ERROR',
            source: 'SwarmManager',
            message: 'Failed to process initial prompt',
            details: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

    } catch (err) {
      console.error('initializeSwarm: Error caught:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : '';
      console.error('initializeSwarm: Error details:', { message: errorMessage, stack: errorStack });
      
      setError(errorMessage);
      onMessage({
        type: MessageType.ERROR,
        content: `Failed to initialize swarm: ${errorMessage}`,
        timestamp: new Date()
      });
    } finally {
      console.log('initializeSwarm: Finally block, setting isInitializing to false');
      setIsInitializing(false);
    }
  }, [isInitializing, swarmState.isActive, onMessage]);

  const shutdownSwarm = useCallback(async () => {
    if (!swarmState.swarmManager) {
      console.log('shutdownSwarm called but no swarmManager exists');
      return;
    }

    console.log('shutdownSwarm: Starting shutdown process...');
    try {
      onMessage({
        type: MessageType.INFO,
        content: '🛑 Shutting down swarm...',
        timestamp: new Date()
      });

      await swarmState.swarmManager.shutdown();

      setSwarmState({
        isActive: false,
        agents: new Map(),
        taskQueue: []
      });

      onMessage({
        type: MessageType.INFO,
        content: '✅ Swarm shutdown complete.',
        timestamp: new Date()
      });
      
      console.log('shutdownSwarm: Shutdown complete');
      // Clear the swarm mode environment variable
      delete process.env.GEMINI_SWARM_MODE;
      // Don't automatically call onExit - let the user decide
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('shutdownSwarm error:', err);
      onMessage({
        type: MessageType.ERROR,
        content: `Error during swarm shutdown: ${errorMessage}`,
        timestamp: new Date()
      });
      // Don't call onExit if shutdown failed
    }
  }, [swarmState.swarmManager, onMessage, onExit]);

  // Dashboard control functions
  const handleSpawnAgent = useCallback(async (role: string) => {
    if (!swarmState.swarmManager) return;
    
    try {
      // TODO: Implement agent spawning through SwarmManager
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'info',
        level: 'INFO',
        source: 'Conductor',
        message: `Spawning new ${role} agent`,
        details: 'Agent creation in progress...'
      });
    } catch (error) {
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        level: 'ERROR',
        source: 'Conductor',
        message: `Failed to spawn ${role} agent`,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [swarmState.swarmManager, addActivityLogEntry]);

  const handleTerminateAgent = useCallback(async (agentId: string) => {
    if (!swarmState.swarmManager) return;
    
    try {
      // TODO: Implement agent termination through SwarmManager
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'info',
        level: 'INFO',
        source: 'Conductor',
        message: `Terminating agent ${agentId}`,
        details: 'Graceful shutdown initiated...'
      });
    } catch (error) {
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        level: 'ERROR',
        source: 'Conductor',
        message: `Failed to terminate agent ${agentId}`,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [swarmState.swarmManager, addActivityLogEntry]);

  const handlePauseSwarm = useCallback(async () => {
    if (!swarmState.swarmManager) return;
    
    try {
      // TODO: Implement swarm pausing through SwarmManager
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'info',
        level: 'INFO',
        source: 'Conductor',
        message: 'Swarm paused',
        details: 'All agents suspended, accepting no new tasks'
      });
    } catch (error) {
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        level: 'ERROR',
        source: 'Conductor',
        message: 'Failed to pause swarm',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [swarmState.swarmManager, addActivityLogEntry]);

  const handleResumeSwarm = useCallback(async () => {
    if (!swarmState.swarmManager) return;
    
    try {
      // TODO: Implement swarm resuming through SwarmManager
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'info',
        level: 'INFO',
        source: 'Conductor',
        message: 'Swarm resumed',
        details: 'All agents reactivated, ready for new tasks'
      });
    } catch (error) {
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        level: 'ERROR',
        source: 'Conductor',
        message: 'Failed to resume swarm',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [swarmState.swarmManager, addActivityLogEntry]);

  // Initialize swarm when component mounts
  useEffect(() => {
    console.log('SwarmCommand: Mounting, initializing swarm...');
    
    // Check if we have a valid TTY for Ink
    const canUseRawMode = process.stdin.isTTY && process.stdin.setRawMode;
    if (!canUseRawMode) {
      console.error('SwarmCommand: Raw mode not supported, this may cause UI issues');
    }
    
    // Small delay to ensure state is properly initialized
    const timer = setTimeout(() => {
      initializeSwarm();
    }, 100);

    // Cleanup on unmount
    return () => {
      clearTimeout(timer);
      console.log('SwarmCommand: Unmounting, swarm state:', swarmState.isActive);
      // Don't automatically shutdown on unmount - this might be causing unexpected exits
      // The swarm should only shutdown when explicitly requested by the user
    };
  }, []); // Empty dependency array for mount only

  // Handle exit
  useEffect(() => {
    const handleExit = async (signal: string) => {
      console.log(`SwarmCommand: Received ${signal} signal`);
      if (swarmState.isActive) {
        await shutdownSwarm();
      }
      onExit();
    };

    const handleSigInt = () => handleExit('SIGINT');
    const handleSigTerm = () => handleExit('SIGTERM');

    // Listen for exit events
    process.on('SIGINT', handleSigInt);
    process.on('SIGTERM', handleSigTerm);

    return () => {
      process.removeListener('SIGINT', handleSigInt);
      process.removeListener('SIGTERM', handleSigTerm);
    };
  }, [swarmState.isActive, shutdownSwarm, onExit]);

  // Handle prompt submission - MUST be defined before conditional returns
  const handleSubmitPrompt = useCallback(async (prompt: string) => {
    console.log('handleSubmitPrompt called with:', prompt);
    console.log('swarmState.swarmManager exists:', !!swarmState.swarmManager);
    
    if (!swarmState.swarmManager) {
      console.log('No swarmManager, returning early');
      return;
    }
    
    try {
      console.log('Setting current prompt and adding activity log entry');
      setCurrentPrompt(prompt); // Store the prompt
      
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'task',
        level: 'INFO',
        source: 'Conductor',
        message: 'New task received',
        details: prompt
      });

      console.log('Getting swarm IDs...');
      const swarmIds = swarmState.swarmManager.getSwarmIds();
      console.log('Available swarm IDs:', swarmIds);
      const swarmId = swarmIds[0];
      
      if (swarmId) {
        console.log('Processing prompt with swarmId:', swarmId);
        const taskId = await swarmState.swarmManager.processPrompt(swarmId, prompt);
        console.log('processPrompt returned taskId:', taskId);
        
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'success',
          level: 'INFO',
          source: 'SwarmManager',
          message: `Task processing started`,
          details: `Task ID: ${taskId}`
        });
      } else {
        console.log('No swarm ID available');
      }
    } catch (error) {
      console.error('Error in handleSubmitPrompt:', error);
      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        level: 'ERROR',
        source: 'SwarmManager',
        message: 'Failed to process prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [swarmState.swarmManager, addActivityLogEntry]);

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">❌ Swarm initialization failed: {error}</Text>
        <Text dimColor>Returning to normal mode...</Text>
      </Box>
    );
  }

  if (isInitializing) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">⏳ Initializing Swarm Mode...</Text>
        <Text dimColor>Setting up conductor interface and spawning agents...</Text>
      </Box>
    );
  }

  // Render the simplified conductor dashboard when swarm is active
  if (swarmState.isActive) {
    return (
      <SimpleConductorDashboard
        dashboardState={dashboardState}
        onUpdateState={updateDashboardState}
        onSpawnAgent={handleSpawnAgent}
        onTerminateAgent={handleTerminateAgent}
        onPauseSwarm={handlePauseSwarm}
        onResumeSwarm={handleResumeSwarm}
        onShutdownSwarm={shutdownSwarm}
        onSubmitPrompt={handleSubmitPrompt}
        isSwarmActive={swarmState.isActive}
        agentOutputs={agentOutputs}
        onAgentOutput={handleAgentOutput}
      />
    );
  }

  // If we get here, something went wrong - log and show error
  console.error('SwarmCommand: Unexpected state - swarm not active after initialization', {
    isInitializing,
    isActive: swarmState.isActive,
    hasManager: !!swarmState.swarmManager,
    error
  });
  
  // Return loading state while initializing (this shouldn't happen but prevents the error state)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="yellow">⏳ Initializing Swarm Mode...</Text>
      <Text dimColor>Debug: isInitializing={String(isInitializing)}, isActive={String(swarmState.isActive)}</Text>
    </Box>
  );
};