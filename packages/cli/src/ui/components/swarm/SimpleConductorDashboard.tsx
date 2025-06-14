/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { DashboardState } from './types.js';

interface SimpleConductorDashboardProps {
  dashboardState: DashboardState;
  onUpdateState: (updates: Partial<DashboardState>) => void;
  onSpawnAgent?: (role: string) => void;
  onTerminateAgent?: (agentId: string) => void;
  onPauseSwarm?: () => void;
  onResumeSwarm?: () => void;
  onShutdownSwarm?: () => void;
  onSubmitPrompt?: (prompt: string) => void;
  isSwarmActive: boolean;
  agentOutputs?: Map<string, string[]>;
  onAgentOutput?: (agentId: string, output: string) => void;
}

export const SimpleConductorDashboard: React.FC<SimpleConductorDashboardProps> = ({
  dashboardState,
  onUpdateState,
  onSpawnAgent,
  onTerminateAgent,
  onPauseSwarm,
  onResumeSwarm,
  onShutdownSwarm,
  onSubmitPrompt,
  isSwarmActive,
  agentOutputs: parentAgentOutputs,
  onAgentOutput
}) => {
  console.log('SimpleConductorDashboard rendering with:', { isSwarmActive, tasksCount: dashboardState.tasks.length });
  
  // Track component lifecycle
  React.useEffect(() => {
    console.log('SimpleConductorDashboard mounted');
    return () => {
      console.log('SimpleConductorDashboard unmounting!');
    };
  }, []);
  
  // All hooks must be called before any conditional returns
  const [showHelp, setShowHelp] = useState(false);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [showDetailedView, setShowDetailedView] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showTaskHistory, setShowTaskHistory] = useState(false);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [showAgentOutput, setShowAgentOutput] = useState(false);
  const agentOutputs = parentAgentOutputs || new Map<string, string[]>();
  const isShuttingDownRef = React.useRef(false);

  // Only use input handling if TTY is available
  const isTTY = process.stdin.isTTY;
  
  useInput((input, key) => {
    // Skip input handling if not in TTY mode
    if (!isTTY) return;
    
    console.log('useInput detected:', { input, key: key?.escape ? 'escape' : 'other', showPromptInput });
    
    if (showPromptInput) {
      console.log('In prompt input mode, handling escape...');
      // Handle ESC to cancel prompt input
      if (key.escape) {
        console.log('Escape pressed, closing prompt input');
        setShowPromptInput(false);
        setPromptValue('');
      }
      return;
    }
    
    // Handle ESC to go back from agent detail view
    if (selectedAgentId && key.escape) {
      setSelectedAgentId(null);
      return;
    }
    
    if (key.escape || input === 'q') {
      console.log('Quit requested, isShuttingDown:', isShuttingDownRef.current);
      if (onShutdownSwarm && !isShuttingDownRef.current) {
        isShuttingDownRef.current = true;
        onShutdownSwarm();
      }
    } else if (input === 'h') {
      console.log('Help toggled');
      setShowHelp(!showHelp);
    } else if (input === 's') {
      // Show detailed status
      console.log('Status/detailed view toggled');
      setShowDetailedView(!showDetailedView);
      setSelectedAgentId(null);
      setShowTaskHistory(false);
    } else if (input === 't') {
      // Show task history
      console.log('Task history toggled');
      setShowTaskHistory(!showTaskHistory);
      setShowDetailedView(false);
      setSelectedAgentId(null);
      setShowAgentOutput(false);
    } else if (input === 'o') {
      // Show agent output/thinking
      console.log('Agent output view toggled');
      setShowAgentOutput(!showAgentOutput);
      setShowDetailedView(false);
      setSelectedAgentId(null);
      setShowTaskHistory(false);
    } else if (showDetailedView && !selectedAgentId && !showAgentOutput) {
      // Navigation in detailed view
      if (key.upArrow) {
        setSelectedAgentIndex(Math.max(0, selectedAgentIndex - 1));
      } else if (key.downArrow) {
        const agentsList = dashboardState.agents ? Array.from(dashboardState.agents.values()) : [];
        setSelectedAgentIndex(Math.min(agentsList.length - 1, selectedAgentIndex + 1));
      } else if (key.return) {
        const agentsList = dashboardState.agents ? Array.from(dashboardState.agents.values()) : [];
        if (agentsList[selectedAgentIndex]) {
          setSelectedAgentId(agentsList[selectedAgentIndex].id);
        }
      }
    } else if (input === 'p') {
      console.log('Pause/resume requested');
      if (isSwarmActive) {
        onPauseSwarm?.();
      } else {
        onResumeSwarm?.();
      }
    } else if (input === 'n' || input === 'N') {
      console.log('New task/prompt requested, showing prompt input');
      // New task/prompt
      setShowPromptInput(true);
      setPromptValue('');
    }
  });

  // Calculate all data needed for rendering (hooks must be called consistently)
  const currentTask = dashboardState.tasks.find(t => t.status === 'in_progress') || 
                     dashboardState.tasks.find(t => t.status === 'pending') ||
                     { description: 'No active tasks', id: 'none' };

  const agents = dashboardState.agents ? Array.from(dashboardState.agents.values()) : [];
  const activeAgents = agents.filter(a => a.status !== 'idle');

  const totalTasks = dashboardState.tasks?.length || 0;
  const completedTasks = dashboardState.tasks?.filter(t => t.status === 'completed').length || 0;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const recentActivity = dashboardState.activityLog
    .slice(-4)
    .reverse()
    .map(entry => ({
      time: entry.timestamp.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      message: entry.message,
      type: entry.type,
      source: entry.source
    }));

  const progressBarWidth = 20;
  const filledBlocks = Math.round((progress / 100) * progressBarWidth);
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(progressBarWidth - filledBlocks);
  
  // Agent name mapping
  const getAgentName = (agent: any) => {
    const roleNames: Record<string, string> = {
      'orchestrator': 'Task Orchestrator',
      'architect': 'System Architect',
      'developer': 'Code Developer',
      'tester': 'QA Engineer',
      'reviewer': 'Code Reviewer',
      'specialist': 'Domain Specialist'
    };
    return roleNames[agent.role] || agent.role;
  };
  
  // Get work directory (where agent is working)
  const workDirectory = process.cwd();

  // Now handle conditional rendering

  if (showHelp) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
        <Box marginBottom={1}>
          <Text bold color="blue">🐝 SWARM MODE - HELP</Text>
        </Box>
        
        <Box flexDirection="column" marginBottom={1}>
          <Text>Keyboard Controls:</Text>
          <Text>  q, ESC  - Quit swarm mode</Text>
          <Text>  h       - Toggle this help</Text>
          <Text>  s       - Show detailed status (↑↓ to navigate, Enter to select agent)</Text>
          <Text>  t       - Show task history</Text>
          <Text>  o       - Show agent output/thinking (real-time)</Text>
          <Text>  p       - Pause/Resume swarm</Text>
          <Text>  n       - New task/prompt</Text>
        </Box>

        <Box>
          <Text dimColor>Press 'h' again to close help</Text>
        </Box>
      </Box>
    );
  }

  if (showPromptInput) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
        <Box marginBottom={1}>
          <Text bold color="yellow">🐝 NEW TASK - Enter your prompt:</Text>
        </Box>
        
        <Box marginBottom={1}>
          <Text>➤ </Text>
          <TextInput
            value={promptValue}
            onChange={setPromptValue}
            onSubmit={(value) => {
              console.log('TextInput onSubmit called with value:', value);
              console.log('onSubmitPrompt function exists:', !!onSubmitPrompt);
              if (value.trim()) {
                console.log('Calling onSubmitPrompt with:', value.trim());
                onSubmitPrompt?.(value.trim());
              } else {
                console.log('Value is empty, not calling onSubmitPrompt');
              }
              setShowPromptInput(false);
              setPromptValue('');
            }}
            placeholder="Describe what you want the swarm to work on..."
          />
        </Box>
        

        <Box>
          <Text dimColor>Press Enter to submit • ESC to cancel</Text>
        </Box>
      </Box>
    );
  }
  
  // Individual Agent Detail View
  if (selectedAgentId) {
    const agent = agents.find(a => a.id === selectedAgentId);
    if (!agent) {
      // Agent no longer exists, go back to detailed view
      setSelectedAgentId(null);
      setShowDetailedView(true);
      // Fall through to render detailed view instead
    } else if (agent) {
      const agentTasks = dashboardState.tasks.filter(t => t.assignedAgent === agent.id);
      const currentTask = agent.currentTask;
      
      return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="magenta">
        <Box marginBottom={1}>
          <Text bold color="magenta">🤖 AGENT DETAILS - {getAgentName(agent)}</Text>
        </Box>
        
        {/* Agent Info */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Basic Information:</Text>
          <Text>  ID: {agent.id}</Text>
          <Text>  Role: {agent.role}</Text>
          <Text>  Status: <Text color={agent.status === 'busy' ? 'yellow' : 'green'}>{agent.status}</Text></Text>
          <Text>  Health Score: {agent.healthScore}%</Text>
        </Box>
        
        {/* Current Task Details */}
        {currentTask && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold underline>Current Task:</Text>
            <Text>  ID: {currentTask.id}</Text>
            <Text>  Description: {currentTask.description}</Text>
            <Text>  Progress: {currentTask.progress || 0}%</Text>
            <Text>  Started: {currentTask.startedAt ? new Date(currentTask.startedAt).toLocaleTimeString() : 'N/A'}</Text>
            <Text>  Duration: {currentTask.startedAt ? Math.round((Date.now() - new Date(currentTask.startedAt).getTime()) / 1000) + 's' : 'N/A'}</Text>
          </Box>
        )}
        
        {/* Resource Usage */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Resource Usage:</Text>
          <Text>  Memory: {agent.memoryUsage}MB</Text>
          <Text>  CPU: {agent.cpuUsage}%</Text>
          <Text>  Response Time: {agent.responseTime}ms</Text>
        </Box>
        
        {/* Task Statistics */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Task Statistics:</Text>
          <Text>  Total Tasks: {agent.totalTasks}</Text>
          <Text>  Completed: {agent.completedTasks}</Text>
          <Text>  Failed: {agent.failedTasks}</Text>
          <Text>  Success Rate: {agent.successRate}%</Text>
        </Box>
        
        {/* Work Location */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Work Location:</Text>
          <Text>  Directory: {workDirectory}</Text>
          <Text>  Process ID: {agent.id.slice(0, 8)}</Text>
        </Box>
        
        {/* Task History for this Agent */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Task History:</Text>
          {agentTasks.length === 0 ? (
            <Text dimColor>  No tasks assigned yet</Text>
          ) : (
            agentTasks.slice(-5).map(task => (
              <Text key={task.id} dimColor>
                  [{task.status}] {task.description.slice(0, 50)}...
              </Text>
            ))
          )}
        </Box>
        
        <Box>
          <Text dimColor>Press ESC to go back • 'q' to quit</Text>
        </Box>
      </Box>
      );
    }
  }
  
  // Task History View
  if (showTaskHistory) {
    const allTasks = [...dashboardState.tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const failedTasks = allTasks.filter(t => t.status === 'failed');
    const pendingTasks = allTasks.filter(t => t.status === 'pending');
    const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
    
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
        <Box marginBottom={1}>
          <Text bold color="yellow">📋 TASK HISTORY</Text>
        </Box>
        
        {/* Summary */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Summary:</Text>
          <Text>  Total Tasks: {allTasks.length}</Text>
          <Text>  Completed: <Text color="green">{completedTasks.length}</Text></Text>
          <Text>  In Progress: <Text color="yellow">{inProgressTasks.length}</Text></Text>
          <Text>  Pending: <Text color="blue">{pendingTasks.length}</Text></Text>
          <Text>  Failed: <Text color="red">{failedTasks.length}</Text></Text>
        </Box>
        
        {/* Task List */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>All Tasks (newest first):</Text>
          {allTasks.length === 0 ? (
            <Text dimColor>  No tasks recorded</Text>
          ) : (
            allTasks.slice(0, 15).map(task => {
              const agent = agents.find(a => a.id === task.assignedAgent);
              return (
                <Box key={task.id} marginLeft={2}>
                  <Text>
                    [{task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : task.status === 'in_progress' ? '⟳' : '○'}]
                    {' '}{task.description.slice(0, 50)}...
                  </Text>
                  {agent && (
                    <Text dimColor>    → {getAgentName(agent)} | {new Date(task.createdAt).toLocaleTimeString()}</Text>
                  )}
                </Box>
              );
            })
          )}
        </Box>
        
        <Box>
          <Text dimColor>Press 't' to go back • 'q' to quit</Text>
        </Box>
      </Box>
    );
  }
  
  // Agent Output/Thinking View
  if (showAgentOutput) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="green">
        <Box marginBottom={1}>
          <Text bold color="green">🧠 AGENT OUTPUT / THINKING</Text>
        </Box>
        
        {agents.length === 0 ? (
          <Text dimColor>No agents active</Text>
        ) : (
          <Box flexDirection="column">
            {agents.map((agent, index) => {
              const outputs = agentOutputs.get(agent.id) || [];
              const recentOutputs = outputs.slice(-20); // Show last 20 lines per agent
              
              return (
                <Box key={agent.id} flexDirection="column" marginBottom={1}>
                  <Text bold color="cyan">
                    {getAgentName(agent)} ({agent.status})
                  </Text>
                  <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
                    {recentOutputs.length === 0 ? (
                      <Text dimColor>No output yet...</Text>
                    ) : (
                      recentOutputs.map((line, idx) => (
                        <Text key={idx} dimColor={line.startsWith('[') || line.includes('DEBUG')}>
                          {line}
                        </Text>
                      ))
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
        
        <Box marginTop={1}>
          <Text dimColor>Press 'o' to go back • Auto-updates in real-time</Text>
        </Box>
      </Box>
    );
  }

  if (showDetailedView) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
        <Box marginBottom={1}>
          <Text bold color="blue">🐝 SWARM MODE - DETAILED VIEW</Text>
        </Box>
        
        {/* Agent Details */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>📊 Agent Status:</Text>
          {agents.length === 0 ? (
            <Text dimColor>  No agents spawned</Text>
          ) : (
            agents.map((agent, index) => (
              <Box key={agent.id} flexDirection="column" marginLeft={2} marginBottom={1}>
                <Text bold color={index === selectedAgentIndex ? 'magenta' : 'cyan'}>
                  {index === selectedAgentIndex ? '▶ ' : '• '}{getAgentName(agent)} [{agent.status}]
                </Text>
                <Text>  ID: {agent.id.slice(0, 8)}...</Text>
                {agent.currentTask && (
                  <>
                    <Text>  Current Task: {agent.currentTask.description}</Text>
                    <Text>  Progress: {agent.currentTask.progress || 0}% | Started: {new Date(agent.currentTask.startedAt).toLocaleTimeString()}</Text>
                  </>
                )}
                <Text>  Resources: {agent.memoryUsage}MB memory | {agent.cpuUsage}% CPU</Text>
                <Text>  Performance: {agent.completedTasks}/{agent.totalTasks} tasks | {agent.successRate}% success rate</Text>
              </Box>
            ))
          )}
        </Box>

        {/* Task Details */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>📋 Task Queue:</Text>
          {dashboardState.tasks.length === 0 ? (
            <Text dimColor>  No tasks in queue</Text>
          ) : (
            dashboardState.tasks.map(task => (
              <Box key={task.id} marginLeft={2} marginBottom={1}>
                <Text>• [{task.status}] {task.type}: {task.description.slice(0, 60)}...</Text>
                {task.assignedAgent && (
                  <Text dimColor>  → Assigned to: {task.assignedAgent.slice(0, 8)}...</Text>
                )}
              </Box>
            ))
          )}
        </Box>

        {/* Activity Log Preview */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>📜 Recent Activity:</Text>
          {recentActivity.map((entry, index) => (
            <Text key={index} dimColor>  [{entry.time}] {entry.source}: {entry.message}</Text>
          ))}
        </Box>

        <Box>
          <Text dimColor>Use ↑↓ to navigate • Enter to select agent • 's' for summary • 'q' to quit</Text>
        </Box>
      </Box>
    );
  }

  // Add error boundary for the main view
  try {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="green">
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="green">
            🐝 SWARM MODE - {isSwarmActive ? 'Active' : 'Paused'} ({agents.length} agents)
          </Text>
        </Box>

      {/* Current Task */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>📝 Current Task:</Text>
        <Box marginLeft={2}>
          <Text color="cyan">{currentTask.description}</Text>
        </Box>
      </Box>

      {/* Active Agents */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>🤖 Agents Working:</Text>
        {activeAgents.length > 0 ? (
          activeAgents.map(agent => (
            <Box key={agent.id} marginLeft={2}>
              <Text>
                • <Text color="yellow">{agent.role}</Text>{' '}
                <Text dimColor>({agent.status}...)</Text>
              </Text>
            </Box>
          ))
        ) : (
          <Box marginLeft={2}>
            <Text dimColor>No agents currently active</Text>
          </Box>
        )}
      </Box>

      {/* Progress */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>📊 Progress: {progressBar} {progress}%</Text>
        <Box marginLeft={2}>
          <Text dimColor>
            {completedTasks}/{totalTasks} tasks completed
          </Text>
        </Box>
      </Box>

      {/* Recent Activity */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>💬 Latest Updates:</Text>
        {recentActivity.length > 0 ? (
          recentActivity.map((activity, index) => (
            <Box key={index} marginLeft={2}>
              <Text>
                <Text dimColor>[{activity.time}]</Text>{' '}
                <Text color="magenta">{activity.source}</Text>: {activity.message}
                {activity.type === 'success' && ' ✅'}
                {activity.type === 'error' && ' ❌'}
              </Text>
            </Box>
          ))
        ) : (
          <Box marginLeft={2}>
            <Text dimColor>No recent activity</Text>
          </Box>
        )}
      </Box>

      {/* Next Steps */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>🎯 Next:</Text>
        <Box marginLeft={2}>
          {dashboardState.tasks.find(t => t.status === 'pending') ? (
            <Text color="blue">
              {dashboardState.tasks.find(t => t.status === 'pending')?.description}
            </Text>
          ) : (
            <Text dimColor>All tasks completed</Text>
          )}
        </Box>
      </Box>

      {/* Footer Controls */}
      <Box borderStyle="single" borderTop={true} paddingTop={1}>
        <Text dimColor>
          {isTTY ? "'q' quit • 'h' help • 's' details • 't' history • 'o' output • 'n' new • 'p' pause" : "Non-interactive mode - Ctrl+C to exit"}
        </Text>
      </Box>
    </Box>
  );
  } catch (error) {
    console.error('Error in SimpleConductorDashboard render:', error);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
        <Text color="red">Error in swarm dashboard. Press 'q' to exit.</Text>
      </Box>
    );
  }
};