/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Operation } from '../file-operations-types.js';

/**
 * Directed Acyclic Graph node
 */
export interface DAGNode<T> {
  id: string;
  data: T;
  dependencies: Set<string>;
  dependents: Set<string>;
}

/**
 * Execution stage - operations that can run in parallel
 */
export interface ExecutionStage<T> {
  stage: number;
  operations: T[];
  canRunInParallel: boolean;
  estimatedDuration?: number;
}

/**
 * Operation grouping for optimization
 */
export interface OperationGroup {
  id: string;
  operations: Operation[];
  type: 'file-locality' | 'operation-type' | 'dependency-chain';
  priority: number;
  canParallelize: boolean;
}

/**
 * Execution plan
 */
export interface ExecutionPlan {
  stages: Array<ExecutionStage<Operation>>;
  groups: OperationGroup[];
  totalEstimatedDuration: number;
  parallelizationOpportunities: number;
  criticalPath: string[];
}

/**
 * DAG implementation for operation dependencies
 */
export class DirectedAcyclicGraph<T> {
  private nodes: Map<string, DAGNode<T>> = new Map();

  /**
   * Add a node to the graph
   */
  addNode(id: string, data: T, dependencies: string[] = []): void {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id '${id}' already exists`);
    }

    const node: DAGNode<T> = {
      id,
      data,
      dependencies: new Set(dependencies),
      dependents: new Set()
    };

    this.nodes.set(id, node);

    // Update dependent nodes
    for (const depId of dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents.add(id);
      }
    }
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): DAGNode<T> | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): Array<DAGNode<T>> {
    return Array.from(this.nodes.values());
  }

  /**
   * Check if the graph has cycles using DFS
   */
  hasCycles(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) {
        return true; // Cycle detected
      }
      if (visited.has(nodeId)) {
        return false; // Already processed
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        // Follow dependencies to detect cycles
        for (const dependencyId of node.dependencies) {
          if (dfs(dependencyId)) {
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get topological sort of nodes
   */
  topologicalSort(): T[] {
    if (this.hasCycles()) {
      throw new Error('Cannot perform topological sort on graph with cycles');
    }

    const visited = new Set<string>();
    const result: T[] = [];

    const dfs = (nodeId: string): void => {
      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        // Visit all dependencies first
        for (const depId of node.dependencies) {
          dfs(depId);
        }
        result.push(node.data);
      }
    };

    for (const nodeId of this.nodes.keys()) {
      dfs(nodeId);
    }

    return result;
  }

  /**
   * Get execution stages - groups of nodes that can execute in parallel
   */
  getExecutionStages(): Array<ExecutionStage<T>> {
    if (this.hasCycles()) {
      throw new Error('Cannot create execution stages for graph with cycles');
    }

    const stages: Array<ExecutionStage<T>> = [];
    const processed = new Set<string>();
    const inDegree = new Map<string, number>();

    // Calculate in-degrees
    for (const node of this.nodes.values()) {
      inDegree.set(node.id, node.dependencies.size);
    }

    let stageNumber = 0;

    while (processed.size < this.nodes.size) {
      const currentStage: T[] = [];

      // Find all nodes with in-degree 0 (no unprocessed dependencies)
      for (const [nodeId, degree] of inDegree) {
        if (degree === 0 && !processed.has(nodeId)) {
          const node = this.nodes.get(nodeId);
          if (node) {
            currentStage.push(node.data);
            processed.add(nodeId);
          }
        }
      }

      if (currentStage.length === 0) {
        throw new Error('Unable to create execution stages - possible cycle detected');
      }

      stages.push({
        stage: stageNumber++,
        operations: currentStage,
        canRunInParallel: currentStage.length > 1
      });

      // Update in-degrees for next iteration
      for (const node of this.nodes.values()) {
        if (processed.has(node.id)) {
          for (const dependentId of node.dependents) {
            const currentDegree = inDegree.get(dependentId) || 0;
            inDegree.set(dependentId, Math.max(0, currentDegree - 1));
          }
        }
      }
    }

    return stages;
  }

  /**
   * Find critical path (longest path through the graph)
   */
  findCriticalPath(): string[] {
    if (this.hasCycles()) {
      throw new Error('Cannot find critical path in graph with cycles');
    }

    const distances = new Map<string, number>();
    const predecessors = new Map<string, string | null>();

    // Initialize distances
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, 0);
      predecessors.set(nodeId, null);
    }

    // Process nodes in topological order
    const sortedNodes = this.topologicalSort();
    const nodeIds = Array.from(this.nodes.keys());

    for (const nodeData of sortedNodes) {
      const currentNodeId = nodeIds.find(id => this.nodes.get(id)?.data === nodeData);
      if (!currentNodeId) continue;

      const currentNode = this.nodes.get(currentNodeId);
      if (!currentNode) continue;

      const currentDistance = distances.get(currentNodeId) || 0;

      for (const dependentId of currentNode.dependents) {
        const newDistance = currentDistance + 1; // Assuming unit weight for each operation
        const existingDistance = distances.get(dependentId) || 0;

        if (newDistance > existingDistance) {
          distances.set(dependentId, newDistance);
          predecessors.set(dependentId, currentNodeId);
        }
      }
    }

    // Find the node with maximum distance
    let maxDistance = 0;
    let endNode: string | null = null;

    for (const [nodeId, distance] of distances) {
      if (distance > maxDistance) {
        maxDistance = distance;
        endNode = nodeId;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current = endNode;

    while (current !== null) {
      path.unshift(current);
      current = predecessors.get(current) || null;
    }

    return path;
  }
}

/**
 * Operation Planner Service
 * Analyzes operation dependencies and creates optimal execution plans
 */
export class OperationPlanner {
  /**
   * Build DAG from operations
   */
  buildDAG(operations: Operation[]): DirectedAcyclicGraph<Operation> {
    const dag = new DirectedAcyclicGraph<Operation>();

    // Create a map of operation IDs for validation
    const opIds = new Set<string>();
    for (const operation of operations) {
      const id = operation.id || this.generateOperationId(operation);
      opIds.add(id);
    }

    // Add all nodes with filtered dependencies (only include valid dependencies)
    for (const operation of operations) {
      const id = operation.id || this.generateOperationId(operation);
      const dependencies = (operation.dependsOn || []).filter(depId => opIds.has(depId));
      dag.addNode(id, { ...operation, id }, dependencies);
    }

    // Validate no cycles exist
    if (dag.hasCycles()) {
      throw new Error('Circular dependency detected in operations');
    }

    return dag;
  }

  /**
   * Analyze dependencies and create execution plan
   */
  createExecutionPlan(operations: Operation[]): ExecutionPlan {
    // Build dependency graph
    const dag = this.buildDAG(operations);
    
    // Get execution stages
    const stages = dag.getExecutionStages();
    
    // Group operations for optimization
    const groups = this.groupOperations(operations);
    
    // Find critical path
    const criticalPath = dag.findCriticalPath();
    
    // Calculate parallelization opportunities
    const parallelizationOpportunities = stages.filter(stage => 
      stage.canRunInParallel
    ).length;
    
    // Estimate total duration (simplified)
    const totalEstimatedDuration = stages.length * 100; // 100ms per stage estimate
    
    return {
      stages,
      groups,
      totalEstimatedDuration,
      parallelizationOpportunities,
      criticalPath
    };
  }

  /**
   * Group operations by various criteria for optimization
   */
  groupOperations(operations: Operation[]): OperationGroup[] {
    const groups: OperationGroup[] = [];

    // Group by file locality
    const fileGroups = this.groupByFileLocality(operations);
    groups.push(...fileGroups);

    // Group by operation type
    const typeGroups = this.groupByOperationType(operations);
    groups.push(...typeGroups);

    // Group by dependency chains
    const chainGroups = this.groupByDependencyChains(operations);
    groups.push(...chainGroups);

    return groups;
  }

  /**
   * Group operations that work on the same files
   */
  private groupByFileLocality(operations: Operation[]): OperationGroup[] {
    const fileToOps = new Map<string, Operation[]>();

    for (const operation of operations) {
      const files = this.extractFilesFromOperation(operation);
      
      for (const file of files) {
        if (!fileToOps.has(file)) {
          fileToOps.set(file, []);
        }
        fileToOps.get(file)!.push(operation);
      }
    }

    const groups: OperationGroup[] = [];
    let groupId = 0;

    for (const [_file, ops] of fileToOps) {
      if (ops.length > 1) {
        groups.push({
          id: `file-locality-${groupId++}`,
          operations: ops,
          type: 'file-locality',
          priority: ops.length, // Higher priority for more operations
          canParallelize: this.canParallelizeOperations(ops)
        });
      }
    }

    return groups;
  }

  /**
   * Group operations by type (analyze, edit, create, etc.)
   */
  private groupByOperationType(operations: Operation[]): OperationGroup[] {
    const typeToOps = new Map<string, Operation[]>();

    for (const operation of operations) {
      const type = operation.type;
      if (!typeToOps.has(type)) {
        typeToOps.set(type, []);
      }
      typeToOps.get(type)!.push(operation);
    }

    const groups: OperationGroup[] = [];
    let groupId = 0;

    for (const [type, ops] of typeToOps) {
      if (ops.length > 1) {
        groups.push({
          id: `operation-type-${groupId++}`,
          operations: ops,
          type: 'operation-type',
          priority: this.getOperationTypePriority(type),
          canParallelize: type === 'analyze' || type === 'validate'
        });
      }
    }

    return groups;
  }

  /**
   * Group operations that form dependency chains
   */
  private groupByDependencyChains(operations: Operation[]): OperationGroup[] {
    const groups: OperationGroup[] = [];
    const processed = new Set<string>();

    for (const operation of operations) {
      const id = operation.id || this.generateOperationId(operation);
      
      if (processed.has(id)) {
        continue;
      }

      const chain = this.findDependencyChain(operation, operations);
      
      if (chain.length > 1) {
        groups.push({
          id: `dependency-chain-${groups.length}`,
          operations: chain,
          type: 'dependency-chain',
          priority: chain.length,
          canParallelize: false // Dependency chains must be sequential
        });

        for (const chainOp of chain) {
          processed.add(chainOp.id || this.generateOperationId(chainOp));
        }
      }
    }

    return groups;
  }

  /**
   * Find dependency chain starting from an operation
   */
  private findDependencyChain(startOp: Operation, allOps: Operation[]): Operation[] {
    const chain = [startOp];
    const opMap = new Map<string, Operation>();

    // Build operation map
    for (const op of allOps) {
      const id = op.id || this.generateOperationId(op);
      opMap.set(id, op);
    }

    // Follow dependency chain backwards (find dependencies)
    let current = startOp;
    while (current.dependsOn && current.dependsOn.length === 1) {
      const depOp = opMap.get(current.dependsOn[0]);
      if (depOp && !chain.includes(depOp)) {
        chain.unshift(depOp);
        current = depOp;
      } else {
        break;
      }
    }

    // Follow dependency chain forwards (find dependents)
    current = startOp;
    const startId = current.id || this.generateOperationId(current);
    
    for (const op of allOps) {
      if (op.dependsOn && op.dependsOn.includes(startId) && !chain.includes(op)) {
        // Only add if it's a single dependency chain
        if (op.dependsOn.length === 1) {
          chain.push(op);
          current = op;
        }
      }
    }

    return chain;
  }

  /**
   * Extract file paths from operation
   */
  private extractFilesFromOperation(operation: Operation): string[] {
    const files: string[] = [];

    switch (operation.type) {
      case 'analyze':
        if ('paths' in operation && Array.isArray(operation.paths)) {
          files.push(...operation.paths);
        }
        break;
      case 'edit':
        if ('edits' in operation && Array.isArray(operation.edits)) {
          for (const edit of operation.edits) {
            if (typeof edit === 'object' && edit !== null && 'file' in edit && typeof edit.file === 'string') {
              files.push(edit.file);
            }
          }
        }
        break;
      case 'create':
        if ('files' in operation && Array.isArray(operation.files)) {
          for (const file of operation.files) {
            if (typeof file === 'object' && file !== null && 'path' in file && typeof file.path === 'string') {
              files.push(file.path);
            }
          }
        }
        break;
      case 'delete':
        if ('paths' in operation && Array.isArray(operation.paths)) {
          files.push(...operation.paths);
        }
        break;
      case 'validate':
        if ('files' in operation && Array.isArray(operation.files)) {
          for (const file of operation.files) {
            if (typeof file === 'string') {
              files.push(file);
            }
          }
        }
        break;
      default:
        // Unknown operation type
        break;
    }

    return files;
  }

  /**
   * Check if operations can be parallelized
   */
  private canParallelizeOperations(operations: Operation[]): boolean {
    const files = new Set<string>();
    const hasWrite = operations.some(op => 
      op.type === 'edit' || op.type === 'create' || op.type === 'delete'
    );

    for (const operation of operations) {
      const opFiles = this.extractFilesFromOperation(operation);
      for (const filePath of opFiles) {
        if (files.has(filePath) && hasWrite) {
          return false; // Can't parallelize writes to same file
        }
        files.add(filePath);
      }
    }

    return true;
  }

  /**
   * Get priority for operation types
   */
  private getOperationTypePriority(type: string): number {
    const priorities: Record<string, number> = {
      'analyze': 1,    // Highest priority
      'validate': 2,
      'create': 3,
      'edit': 4,
      'delete': 5      // Lowest priority
    };

    return priorities[type] || 3;
  }

  /**
   * Generate unique ID for operation
   */
  private generateOperationId(operation: Operation): string {
    const type = operation.type;
    // Create a consistent hash based on operation content
    let hash = 0;
    const str = JSON.stringify(operation);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${type}-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Optimize execution plan
   */
  optimizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    // Optimize stages by merging compatible operations
    const optimizedStages = this.optimizeStages(plan.stages);
    
    // Re-calculate metrics
    const parallelizationOpportunities = optimizedStages.filter(stage => 
      stage.canRunInParallel
    ).length;
    
    const totalEstimatedDuration = optimizedStages.reduce((total, stage) => 
      total + (stage.estimatedDuration || 100), 0
    );

    return {
      ...plan,
      stages: optimizedStages,
      parallelizationOpportunities,
      totalEstimatedDuration
    };
  }

  /**
   * Optimize execution stages
   */
  private optimizeStages(stages: Array<ExecutionStage<Operation>>): Array<ExecutionStage<Operation>> {
    const optimized: Array<ExecutionStage<Operation>> = [];

    for (const stage of stages) {
      // Group operations within stage by type for better batching
      const typeGroups = new Map<string, Operation[]>();
      
      for (const operation of stage.operations) {
        const type = operation.type;
        if (!typeGroups.has(type)) {
          typeGroups.set(type, []);
        }
        typeGroups.get(type)!.push(operation);
      }

      // Estimate duration based on operation complexity
      const estimatedDuration = this.estimateStageDuration(stage.operations);

      optimized.push({
        ...stage,
        estimatedDuration
      });
    }

    return optimized;
  }

  /**
   * Estimate duration for a stage
   */
  private estimateStageDuration(operations: Operation[]): number {
    const durations = operations.map(operation => {
      switch (operation.type) {
        case 'analyze':
          return 200; // Analysis takes longer
        case 'edit':
          return 100;
        case 'create':
          return 150;
        case 'delete':
          return 50;
        case 'validate':
          return 300; // Validation can be slow
        default:
          return 100;
      }
    });

    // If operations can run in parallel, use max duration
    // If they run sequentially, sum the durations
    if (operations.length > 1) {
      return Math.max(...durations);
    }

    return durations[0] || 100;
  }
}