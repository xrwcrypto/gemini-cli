/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileOperationsMigrationConfig, MigrationPhase } from './migration-config.js';
import { RollbackManager, RollbackAction, RollbackState } from './rollback-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

/**
 * Configuration-based rollback policies
 */
export interface RollbackPolicy {
  name: string;
  description: string;
  conditions: {
    errorThreshold?: number;
    performanceThreshold?: number;
    adoptionThreshold?: number;
    timeWindow?: number; // minutes
  };
  actions: {
    scope: 'global' | 'tool' | 'gradual';
    fallbackPhase: MigrationPhase;
    preserveSettings: boolean;
    notifyUsers: boolean;
  };
  recovery: {
    autoRevert: boolean;
    revertConditions?: {
      errorRateNormal: boolean;
      performanceImproved: boolean;
      minStableTime: number; // minutes
    };
  };
}

/**
 * Predefined rollback policies
 */
export const ROLLBACK_POLICIES: Record<string, RollbackPolicy> = {
  conservative: {
    name: 'Conservative Rollback',
    description: 'Immediate rollback on any degradation',
    conditions: {
      errorThreshold: 0.02, // 2%
      performanceThreshold: 1.2, // 20% slower
      timeWindow: 5,
    },
    actions: {
      scope: 'global',
      fallbackPhase: MigrationPhase.DISABLED,
      preserveSettings: true,
      notifyUsers: true,
    },
    recovery: {
      autoRevert: false,
    },
  },
  
  balanced: {
    name: 'Balanced Rollback',
    description: 'Gradual rollback with tool-specific handling',
    conditions: {
      errorThreshold: 0.05, // 5%
      performanceThreshold: 1.5, // 50% slower
      timeWindow: 10,
    },
    actions: {
      scope: 'tool',
      fallbackPhase: MigrationPhase.ADAPTERS,
      preserveSettings: true,
      notifyUsers: false,
    },
    recovery: {
      autoRevert: true,
      revertConditions: {
        errorRateNormal: true,
        performanceImproved: true,
        minStableTime: 30,
      },
    },
  },
  
  aggressive: {
    name: 'Aggressive Migration',
    description: 'High tolerance for issues, minimal rollback',
    conditions: {
      errorThreshold: 0.10, // 10%
      performanceThreshold: 2.0, // 100% slower
      timeWindow: 30,
    },
    actions: {
      scope: 'gradual',
      fallbackPhase: MigrationPhase.ADAPTERS,
      preserveSettings: true,
      notifyUsers: false,
    },
    recovery: {
      autoRevert: true,
      revertConditions: {
        errorRateNormal: true,
        performanceImproved: false,
        minStableTime: 60,
      },
    },
  },
};

/**
 * Configuration-based rollback controller
 */
export class ConfigBasedRollbackController {
  private rollbackManager: RollbackManager;
  private configPath: string;
  private policy: RollbackPolicy;
  private activeWatchers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(
    rollbackManager: RollbackManager,
    policy: RollbackPolicy = ROLLBACK_POLICIES.balanced,
    configPath?: string
  ) {
    this.rollbackManager = rollbackManager;
    this.policy = policy;
    this.configPath = configPath || this.getDefaultConfigPath();
  }
  
  /**
   * Enable configuration-based rollback monitoring
   */
  enableConfigBasedRollback(config: FileOperationsMigrationConfig): void {
    // Start file watcher for configuration changes
    this.watchConfigFile();
    
    // Start policy-based monitoring
    this.startPolicyMonitoring(config);
    
    console.log(`[ConfigBasedRollback] Enabled with policy: ${this.policy.name}`);
  }
  
  /**
   * Disable configuration-based rollback monitoring
   */
  disableConfigBasedRollback(): void {
    // Stop all watchers
    for (const [, timeout] of this.activeWatchers) {
      clearTimeout(timeout);
    }
    this.activeWatchers.clear();
    
    console.log('[ConfigBasedRollback] Disabled monitoring');
  }
  
  /**
   * Trigger emergency rollback via configuration file
   */
  triggerEmergencyRollback(reason: string = 'Emergency rollback triggered'): void {
    const emergencyConfig: Partial<FileOperationsMigrationConfig> = {
      phase: MigrationPhase.DISABLED,
      rolloutPercentage: 0,
      rollback: {
        autoRollback: false,
        errorThreshold: 0,
        performanceThreshold: 1,
        minSampleSize: 1,
      },
      debug: {
        enabled: true,
        logAdapterDecisions: true,
        logPerformanceComparisons: true,
        dryRun: false,
      },
    };
    
    this.writeEmergencyConfig(emergencyConfig, reason);
    
    // Also trigger direct rollback
    this.rollbackManager.triggerManualRollback('global', undefined, reason);
  }
  
  /**
   * Create rollback checkpoint for easy restoration
   */
  createRollbackCheckpoint(name: string): string {
    const timestamp = new Date().toISOString();
    const checkpointData = {
      name,
      timestamp,
      config: this.loadCurrentConfig(),
      policy: this.policy,
    };
    
    const checkpointPath = path.join(
      path.dirname(this.configPath),
      `rollback-checkpoint-${name}-${Date.now()}.json`
    );
    
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpointData, null, 2));
    
    console.log(`[ConfigBasedRollback] Checkpoint created: ${checkpointPath}`);
    return checkpointPath;
  }
  
  /**
   * Restore from rollback checkpoint
   */
  restoreFromCheckpoint(checkpointPath: string): boolean {
    try {
      const checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      
      // Restore configuration
      this.writeConfig(checkpointData.config);
      
      // Restore policy
      this.policy = checkpointData.policy;
      
      console.log(`[ConfigBasedRollback] Restored from checkpoint: ${checkpointData.name}`);
      return true;
    } catch (error) {
      console.error('[ConfigBasedRollback] Failed to restore checkpoint:', error);
      return false;
    }
  }
  
  /**
   * Generate rollback configuration commands
   */
  generateRollbackCommands(): {
    immediate: string[];
    gradual: string[];
    recovery: string[];
  } {
    const configFile = this.getSettingsPath();
    
    return {
      immediate: [
        `# Immediate rollback commands`,
        `echo '{"fileOperationsMigration":{"phase":"disabled"}}' > ${configFile}`,
        `# OR use CLI (if available)`,
        `gemini config set fileOperationsMigration.phase disabled`,
        `gemini config set fileOperationsMigration.rolloutPercentage 0`,
      ],
      
      gradual: [
        `# Gradual rollback commands`,
        `gemini config set fileOperationsMigration.rolloutPercentage 50`,
        `# Wait 5 minutes, then:`,
        `gemini config set fileOperationsMigration.rolloutPercentage 25`,
        `# Wait 5 minutes, then:`,
        `gemini config set fileOperationsMigration.rolloutPercentage 0`,
        `# Finally:`,
        `gemini config set fileOperationsMigration.phase adapters`,
      ],
      
      recovery: [
        `# Recovery commands after issues are fixed`,
        `gemini config set fileOperationsMigration.phase adapters`,
        `gemini config set fileOperationsMigration.rolloutPercentage 10`,
        `# Monitor for 30 minutes, then gradually increase`,
        `gemini config set fileOperationsMigration.rolloutPercentage 25`,
        `gemini config set fileOperationsMigration.rolloutPercentage 50`,
        `gemini config set fileOperationsMigration.rolloutPercentage 100`,
      ],
    };\n  }\n  \n  /**\n   * Watch configuration file for manual rollback triggers\n   */\n  private watchConfigFile(): void {\n    if (!fs.existsSync(this.configPath)) {\n      return;\n    }\n    \n    fs.watchFile(this.configPath, (curr, prev) => {\n      if (curr.mtime > prev.mtime) {\n        this.handleConfigChange();\n      }\n    });\n  }\n  \n  /**\n   * Handle configuration file changes\n   */\n  private handleConfigChange(): void {\n    try {\n      const config = this.loadCurrentConfig();\n      \n      // Check for emergency rollback markers\n      if (this.isEmergencyRollbackTriggered(config)) {\n        this.handleEmergencyRollback(config);\n      }\n      \n      // Check for policy changes\n      if (this.isPolicyChangeDetected(config)) {\n        this.handlePolicyChange(config);\n      }\n      \n    } catch (error) {\n      console.error('[ConfigBasedRollback] Error handling config change:', error);\n    }\n  }\n  \n  /**\n   * Start monitoring based on current policy\n   */\n  private startPolicyMonitoring(config: FileOperationsMigrationConfig): void {\n    const intervalMs = (this.policy.conditions.timeWindow || 10) * 60 * 1000;\n    \n    const monitor = setInterval(() => {\n      this.checkPolicyConditions(config);\n    }, intervalMs);\n    \n    this.activeWatchers.set('policy-monitor', monitor as any);\n  }\n  \n  /**\n   * Check if policy-based rollback conditions are met\n   */\n  private checkPolicyConditions(config: FileOperationsMigrationConfig): void {\n    // This would integrate with metrics to check actual conditions\n    // For now, we'll use the existing rollback manager's logic\n    this.rollbackManager.checkRollbackConditions();\n  }\n  \n  /**\n   * Check if emergency rollback is triggered in config\n   */\n  private isEmergencyRollbackTriggered(config: any): boolean {\n    return config.fileOperationsMigration?.emergency?.rollback === true ||\n           config.fileOperationsMigration?.phase === 'emergency_disabled';\n  }\n  \n  /**\n   * Handle emergency rollback from config\n   */\n  private handleEmergencyRollback(config: any): void {\n    const reason = config.fileOperationsMigration?.emergency?.reason || 'Emergency rollback from configuration';\n    \n    console.log('[ConfigBasedRollback] Emergency rollback triggered from config:', reason);\n    \n    this.rollbackManager.triggerManualRollback('global', undefined, reason);\n    \n    // Clean up emergency marker\n    delete config.fileOperationsMigration?.emergency;\n    this.writeConfig(config);\n  }\n  \n  /**\n   * Check if policy change is detected\n   */\n  private isPolicyChangeDetected(config: any): boolean {\n    const configPolicy = config.fileOperationsMigration?.rollbackPolicy;\n    return configPolicy && configPolicy !== this.policy.name;\n  }\n  \n  /**\n   * Handle policy change\n   */\n  private handlePolicyChange(config: any): void {\n    const newPolicyName = config.fileOperationsMigration.rollbackPolicy;\n    const newPolicy = ROLLBACK_POLICIES[newPolicyName];\n    \n    if (newPolicy) {\n      console.log(`[ConfigBasedRollback] Policy changed to: ${newPolicyName}`);\n      this.policy = newPolicy;\n      \n      // Restart monitoring with new policy\n      this.disableConfigBasedRollback();\n      this.startPolicyMonitoring(config);\n    }\n  }\n  \n  /**\n   * Load current configuration\n   */\n  private loadCurrentConfig(): any {\n    try {\n      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));\n    } catch {\n      return {};\n    }\n  }\n  \n  /**\n   * Write configuration to file\n   */\n  private writeConfig(config: any): void {\n    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));\n  }\n  \n  /**\n   * Write emergency configuration\n   */\n  private writeEmergencyConfig(emergencyConfig: Partial<FileOperationsMigrationConfig>, reason: string): void {\n    const currentConfig = this.loadCurrentConfig();\n    \n    const updatedConfig = {\n      ...currentConfig,\n      fileOperationsMigration: {\n        ...currentConfig.fileOperationsMigration,\n        ...emergencyConfig,\n        emergency: {\n          triggered: true,\n          reason,\n          timestamp: new Date().toISOString(),\n        },\n      },\n    };\n    \n    this.writeConfig(updatedConfig);\n    \n    console.log('[ConfigBasedRollback] Emergency configuration written');\n  }\n  \n  /**\n   * Get default configuration path\n   */\n  private getDefaultConfigPath(): string {\n    return path.join(homedir(), '.gemini', 'settings.json');\n  }\n  \n  /**\n   * Get settings path for CLI commands\n   */\n  private getSettingsPath(): string {\n    return this.getDefaultConfigPath();\n  }\n  \n  /**\n   * Generate rollback documentation\n   */\n  generateRollbackDocumentation(): string {\n    return `\n# FileOperations Rollback Guide\n\n## Current Policy: ${this.policy.name}\n${this.policy.description}\n\n## Emergency Rollback\n\nTo trigger immediate emergency rollback:\n\n### Method 1: Configuration File\n\\`\\`\\`bash\n# Edit settings file directly\necho '{\n  \"fileOperationsMigration\": {\n    \"phase\": \"disabled\",\n    \"rolloutPercentage\": 0,\n    \"emergency\": {\n      \"rollback\": true,\n      \"reason\": \"Manual emergency rollback\"\n    }\n  }\n}' > ~/.gemini/settings.json\n\\`\\`\\`\n\n### Method 2: CLI Commands (if available)\n\\`\\`\\`bash\n${this.generateRollbackCommands().immediate.join('\\n')}\n\\`\\`\\`\n\n## Gradual Rollback\n\n\\`\\`\\`bash\n${this.generateRollbackCommands().gradual.join('\\n')}\n\\`\\`\\`\n\n## Recovery After Issues Fixed\n\n\\`\\`\\`bash\n${this.generateRollbackCommands().recovery.join('\\n')}\n\\`\\`\\`\n\n## Monitoring\n\nCurrent rollback conditions:\n- Error threshold: ${this.policy.conditions.errorThreshold ? (this.policy.conditions.errorThreshold * 100).toFixed(1) + '%' : 'Not set'}\n- Performance threshold: ${this.policy.conditions.performanceThreshold ? (this.policy.conditions.performanceThreshold * 100 - 100).toFixed(1) + '% slower' : 'Not set'}\n- Time window: ${this.policy.conditions.timeWindow || 'Default'} minutes\n\n## Checkpoints\n\nCreate checkpoint before risky changes:\n\\`\\`\\`bash\n# This would be exposed via CLI\ngemini migration checkpoint create \"before-major-rollout\"\n\\`\\`\\`\n\nRestore from checkpoint:\n\\`\\`\\`bash\ngemini migration checkpoint restore \"checkpoint-file.json\"\n\\`\\`\\`\n\n## Configuration Structure\n\n\\`\\`\\`json\n{\n  \"fileOperationsMigration\": {\n    \"phase\": \"disabled|adapters|full\",\n    \"rolloutPercentage\": 0,\n    \"rollbackPolicy\": \"conservative|balanced|aggressive\",\n    \"rollback\": {\n      \"autoRollback\": true,\n      \"errorThreshold\": 0.05,\n      \"performanceThreshold\": 1.5,\n      \"minSampleSize\": 100\n    }\n  }\n}\n\\`\\`\\`\n    `;\n  }\n}\n\n/**\n * CLI interface for rollback operations\n */\nexport class RollbackCLI {\n  private controller: ConfigBasedRollbackController;\n  \n  constructor(controller: ConfigBasedRollbackController) {\n    this.controller = controller;\n  }\n  \n  /**\n   * Execute rollback command\n   */\n  executeCommand(command: string, args: string[]): boolean {\n    switch (command) {\n      case 'emergency':\n        this.controller.triggerEmergencyRollback(args[0] || 'CLI emergency rollback');\n        return true;\n        \n      case 'checkpoint':\n        const subcommand = args[0];\n        if (subcommand === 'create') {\n          this.controller.createRollbackCheckpoint(args[1] || 'manual-checkpoint');\n          return true;\n        } else if (subcommand === 'restore') {\n          return this.controller.restoreFromCheckpoint(args[1]);\n        }\n        break;\n        \n      case 'commands':\n        console.log(JSON.stringify(this.controller.generateRollbackCommands(), null, 2));\n        return true;\n        \n      case 'docs':\n        console.log(this.controller.generateRollbackDocumentation());\n        return true;\n    }\n    \n    return false;\n  }\n}\n