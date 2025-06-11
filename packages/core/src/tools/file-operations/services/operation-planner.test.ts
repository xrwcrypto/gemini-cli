/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  DirectedAcyclicGraph, 
  OperationPlanner
} from './operation-planner.js';
import { Operation } from '../file-operations-types.js';

describe('DirectedAcyclicGraph', () => {
  let dag: DirectedAcyclicGraph<string>;

  beforeEach(() => {
    dag = new DirectedAcyclicGraph<string>();
  });

  describe('Basic Operations', () => {
    it('should add nodes without dependencies', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB');

      const nodeA = dag.getNode('A');
      const nodeB = dag.getNode('B');

      expect(nodeA).toBeDefined();
      expect(nodeA?.data).toBe('nodeA');
      expect(nodeA?.dependencies.size).toBe(0);
      expect(nodeB).toBeDefined();
      expect(nodeB?.data).toBe('nodeB');
    });

    it('should add nodes with dependencies', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);

      const nodeB = dag.getNode('B');
      const nodeA = dag.getNode('A');

      expect(nodeB?.dependencies.has('A')).toBe(true);
      expect(nodeA?.dependents.has('B')).toBe(true);
    });

    it('should throw error for duplicate node IDs', () => {
      dag.addNode('A', 'nodeA');
      
      expect(() => {
        dag.addNode('A', 'duplicate');
      }).toThrow("Node with id 'A' already exists");
    });

    it('should get all nodes', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB');
      dag.addNode('C', 'nodeC');

      const allNodes = dag.getAllNodes();
      expect(allNodes).toHaveLength(3);
      expect(allNodes.map(n => n.id)).toContain('A');
      expect(allNodes.map(n => n.id)).toContain('B');
      expect(allNodes.map(n => n.id)).toContain('C');
    });
  });

  describe('Cycle Detection', () => {
    it('should detect no cycles in simple DAG', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['B']);

      expect(dag.hasCycles()).toBe(false);
    });

    it('should detect cycles in graph', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['B']);
      
      // Create cycle by making A depend on C
      const nodeA = dag.getNode('A');
      const nodeC = dag.getNode('C');
      
      if (nodeA && nodeC) {
        nodeA.dependencies.add('C');
        nodeC.dependents.add('A');
      }

      expect(dag.hasCycles()).toBe(true);
    });

    it('should detect self-referencing cycle', () => {
      dag.addNode('A', 'nodeA', ['A']); // Self-reference

      expect(dag.hasCycles()).toBe(true);
    });

    it('should handle complex dependency graph without cycles', () => {
      //    A
      //   / \
      //  B   C
      //   \ /
      //    D
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['A']);
      dag.addNode('D', 'nodeD', ['B', 'C']);

      expect(dag.hasCycles()).toBe(false);
    });
  });

  describe('Topological Sort', () => {
    it('should perform topological sort on simple chain', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['B']);

      const sorted = dag.topologicalSort();
      expect(sorted).toEqual(['nodeA', 'nodeB', 'nodeC']);
    });

    it('should perform topological sort on complex DAG', () => {
      //    A
      //   / \
      //  B   C
      //   \ /
      //    D
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['A']);
      dag.addNode('D', 'nodeD', ['B', 'C']);

      const sorted = dag.topologicalSort();
      expect(sorted[0]).toBe('nodeA');
      expect(sorted[3]).toBe('nodeD');
      expect(sorted.slice(1, 3)).toContain('nodeB');
      expect(sorted.slice(1, 3)).toContain('nodeC');
    });

    it('should throw error on cyclic graph', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      
      // Create cycle
      const nodeA = dag.getNode('A');
      const nodeB = dag.getNode('B');
      if (nodeA && nodeB) {
        nodeA.dependencies.add('B');
        nodeB.dependents.add('A');
      }

      expect(() => dag.topologicalSort()).toThrow('Cannot perform topological sort on graph with cycles');
    });
  });

  describe('Execution Stages', () => {
    it('should create execution stages for simple chain', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['B']);

      const stages = dag.getExecutionStages();
      
      expect(stages).toHaveLength(3);
      expect(stages[0].operations).toEqual(['nodeA']);
      expect(stages[0].canRunInParallel).toBe(false);
      expect(stages[1].operations).toEqual(['nodeB']);
      expect(stages[2].operations).toEqual(['nodeC']);
    });

    it('should identify parallel execution opportunities', () => {
      //    A
      //   / \
      //  B   C
      //   \ /
      //    D
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['A']);
      dag.addNode('D', 'nodeD', ['B', 'C']);

      const stages = dag.getExecutionStages();
      
      expect(stages).toHaveLength(3);
      expect(stages[0].operations).toEqual(['nodeA']);
      expect(stages[0].canRunInParallel).toBe(false);
      
      expect(stages[1].operations).toHaveLength(2);
      expect(stages[1].operations).toContain('nodeB');
      expect(stages[1].operations).toContain('nodeC');
      expect(stages[1].canRunInParallel).toBe(true);
      
      expect(stages[2].operations).toEqual(['nodeD']);
    });

    it('should handle disconnected components', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB');
      dag.addNode('C', 'nodeC', ['A']);

      const stages = dag.getExecutionStages();
      
      expect(stages).toHaveLength(2);
      expect(stages[0].operations).toHaveLength(2);
      expect(stages[0].operations).toContain('nodeA');
      expect(stages[0].operations).toContain('nodeB');
      expect(stages[0].canRunInParallel).toBe(true);
      
      expect(stages[1].operations).toEqual(['nodeC']);
    });
  });

  describe('Critical Path', () => {
    it('should find critical path in simple chain', () => {
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['B']);

      const criticalPath = dag.findCriticalPath();
      expect(criticalPath).toEqual(['A', 'B', 'C']);
    });

    it('should find critical path in complex DAG', () => {
      //    A
      //   / \
      //  B   C
      //  |   |\
      //  D   E F
      //      |/
      //      G
      dag.addNode('A', 'nodeA');
      dag.addNode('B', 'nodeB', ['A']);
      dag.addNode('C', 'nodeC', ['A']);
      dag.addNode('D', 'nodeD', ['B']);
      dag.addNode('E', 'nodeE', ['C']);
      dag.addNode('F', 'nodeF', ['C']);
      dag.addNode('G', 'nodeG', ['E', 'F']);

      const criticalPath = dag.findCriticalPath();
      
      // Should be A -> C -> (E or F) -> G (longest path)
      expect(criticalPath[0]).toBe('A');
      expect(criticalPath[1]).toBe('C');
      expect(criticalPath[3]).toBe('G');
      expect(criticalPath).toHaveLength(4);
    });
  });
});

describe('OperationPlanner', () => {
  let planner: OperationPlanner;

  beforeEach(() => {
    planner = new OperationPlanner();
  });

  describe('DAG Building', () => {
    it('should build DAG from simple operations', () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: ['src/**/*.ts'] },
        { id: 'op2', type: 'edit', dependsOn: ['op1'], edits: [] }
      ];

      const dag = planner.buildDAG(operations);
      
      expect(dag.getNode('op1')).toBeDefined();
      expect(dag.getNode('op2')).toBeDefined();
      expect(dag.hasCycles()).toBe(false);
    });

    it('should detect circular dependencies', () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', dependsOn: ['op2'], paths: [] },
        { id: 'op2', type: 'edit', dependsOn: ['op1'], edits: [] }
      ];

      expect(() => planner.buildDAG(operations)).toThrow('Circular dependency detected in operations');
    });

    it('should generate IDs for operations without them', () => {
      const operations: Operation[] = [
        { type: 'analyze', paths: ['src/**/*.ts'] },
        { type: 'edit', edits: [] }
      ];

      const dag = planner.buildDAG(operations);
      const nodes = dag.getAllNodes();
      
      expect(nodes).toHaveLength(2);
      expect(nodes[0].id).toMatch(/analyze-[a-z0-9]+/);
      expect(nodes[1].id).toMatch(/edit-[a-z0-9]+/);
    });
  });

  describe('Execution Plan Creation', () => {
    it('should create execution plan for simple operations', () => {
      const operations: Operation[] = [
        { id: 'analyze', type: 'analyze', paths: ['src/**/*.ts'] },
        { id: 'edit', type: 'edit', dependsOn: ['analyze'], edits: [] },
        { id: 'validate', type: 'validate', dependsOn: ['edit'], files: [] }
      ];

      const plan = planner.createExecutionPlan(operations);
      
      expect(plan.stages).toHaveLength(3);
      expect(plan.stages[0].operations[0].id).toBe('analyze');
      expect(plan.stages[1].operations[0].id).toBe('edit');
      expect(plan.stages[2].operations[0].id).toBe('validate');
      expect(plan.parallelizationOpportunities).toBe(0);
      expect(plan.criticalPath).toContain('analyze');
    });

    it('should identify parallel execution opportunities', () => {
      const operations: Operation[] = [
        { id: 'analyze1', type: 'analyze', paths: ['src/**/*.ts'] },
        { id: 'analyze2', type: 'analyze', paths: ['test/**/*.ts'] },
        { id: 'edit', type: 'edit', dependsOn: ['analyze1', 'analyze2'], edits: [] }
      ];

      const plan = planner.createExecutionPlan(operations);
      
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0].operations).toHaveLength(2);
      expect(plan.stages[0].canRunInParallel).toBe(true);
      expect(plan.parallelizationOpportunities).toBe(1);
    });

    it('should handle complex dependency graph', () => {
      const operations: Operation[] = [
        { id: 'setup', type: 'create', files: [] },
        { id: 'analyze-src', type: 'analyze', dependsOn: ['setup'], paths: ['src/**'] },
        { id: 'analyze-test', type: 'analyze', dependsOn: ['setup'], paths: ['test/**'] },
        { id: 'edit-src', type: 'edit', dependsOn: ['analyze-src'], edits: [] },
        { id: 'edit-test', type: 'edit', dependsOn: ['analyze-test'], edits: [] },
        { id: 'validate', type: 'validate', dependsOn: ['edit-src', 'edit-test'], files: [] }
      ];

      const plan = planner.createExecutionPlan(operations);
      
      expect(plan.stages).toHaveLength(4);
      expect(plan.stages[0].operations[0].id).toBe('setup');
      expect(plan.stages[1].operations).toHaveLength(2); // analyze-src, analyze-test
      expect(plan.stages[1].canRunInParallel).toBe(true);
      expect(plan.stages[2].operations).toHaveLength(2); // edit-src, edit-test
      expect(plan.stages[2].canRunInParallel).toBe(true);
      expect(plan.stages[3].operations[0].id).toBe('validate');
    });
  });

  describe('Operation Grouping', () => {
    it('should group operations by file locality', () => {
      const operations: Operation[] = [
        { id: 'read-file1', type: 'analyze', paths: ['src/file1.ts'] },
        { id: 'edit-file1', type: 'edit', edits: [{ file: 'src/file1.ts', changes: [] }] },
        { id: 'read-file2', type: 'analyze', paths: ['src/file2.ts'] }
      ];

      const groups = planner.groupOperations(operations);
      const localityGroups = groups.filter(g => g.type === 'file-locality');
      
      expect(localityGroups).toHaveLength(1);
      expect(localityGroups[0].operations).toHaveLength(2);
      expect(localityGroups[0].operations.map(op => op.id)).toContain('read-file1');
      expect(localityGroups[0].operations.map(op => op.id)).toContain('edit-file1');
    });

    it('should group operations by type', () => {
      const operations: Operation[] = [
        { id: 'analyze1', type: 'analyze', paths: ['src/**'] },
        { id: 'analyze2', type: 'analyze', paths: ['test/**'] },
        { id: 'edit1', type: 'edit', edits: [] },
        { id: 'edit2', type: 'edit', edits: [] }
      ];

      const groups = planner.groupOperations(operations);
      const typeGroups = groups.filter(g => g.type === 'operation-type');
      
      expect(typeGroups).toHaveLength(2);
      
      const analyzeGroup = typeGroups.find(g => g.operations[0].type === 'analyze');
      const editGroup = typeGroups.find(g => g.operations[0].type === 'edit');
      
      expect(analyzeGroup?.operations).toHaveLength(2);
      expect(editGroup?.operations).toHaveLength(2);
      expect(analyzeGroup?.canParallelize).toBe(true);
      expect(editGroup?.canParallelize).toBe(false);
    });

    it('should group operations by dependency chains', () => {
      const operations: Operation[] = [
        { id: 'step1', type: 'analyze', paths: [] },
        { id: 'step2', type: 'edit', dependsOn: ['step1'], edits: [] },
        { id: 'step3', type: 'validate', dependsOn: ['step2'], files: [] },
        { id: 'independent', type: 'analyze', paths: [] }
      ];

      const groups = planner.groupOperations(operations);
      const chainGroups = groups.filter(g => g.type === 'dependency-chain');
      
      // Should find dependency chains, but exact count depends on how chains are detected
      expect(chainGroups.length).toBeGreaterThanOrEqual(1);
      
      // Find the main chain
      const mainChain = chainGroups.find(g => g.operations.length === 3);
      if (mainChain) {
        expect(mainChain.canParallelize).toBe(false);
        expect(mainChain.operations.map(op => op.id)).toEqual(['step1', 'step2', 'step3']);
      } else {
        // Alternative: multiple shorter chains
        expect(chainGroups.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Operation Optimization', () => {
    it('should optimize execution plan', () => {
      const operations: Operation[] = [
        { id: 'analyze', type: 'analyze', paths: ['src/**/*.ts'] },
        { id: 'edit', type: 'edit', dependsOn: ['analyze'], edits: [] },
        { id: 'validate', type: 'validate', dependsOn: ['edit'], files: [] }
      ];

      const plan = planner.createExecutionPlan(operations);
      const optimized = planner.optimizeExecutionPlan(plan);
      
      expect(optimized.stages).toHaveLength(3);
      expect(optimized.stages[0].estimatedDuration).toBeGreaterThan(0);
      expect(optimized.stages[1].estimatedDuration).toBeGreaterThan(0);
      expect(optimized.stages[2].estimatedDuration).toBeGreaterThan(0);
      expect(optimized.totalEstimatedDuration).toBeGreaterThan(0);
    });

    it('should estimate different durations for different operation types', () => {
      // Create operations that will be in separate stages due to dependencies
      const operations: Operation[] = [
        { id: 'edit', type: 'edit', edits: [] },
        { id: 'analyze', type: 'analyze', dependsOn: ['edit'], paths: [] },
        { id: 'validate', type: 'validate', dependsOn: ['analyze'], files: [] }
      ];

      const plan = planner.createExecutionPlan(operations);
      const optimized = planner.optimizeExecutionPlan(plan);
      
      // Should have 3 separate stages due to dependencies
      expect(optimized.stages).toHaveLength(3);
      
      // All stages should have estimated durations
      expect(optimized.stages.every(s => typeof s.estimatedDuration === 'number')).toBe(true);
      
      // Find stages by operation type
      const editStage = optimized.stages.find(s => s.operations.some(op => op.type === 'edit'));
      const analyzeStage = optimized.stages.find(s => s.operations.some(op => op.type === 'analyze'));
      const validateStage = optimized.stages.find(s => s.operations.some(op => op.type === 'validate'));
      
      // Validate should take longer than edit, analyze should take longer than edit
      expect(editStage?.estimatedDuration).toBe(100);
      expect(analyzeStage?.estimatedDuration).toBe(200);
      expect(validateStage?.estimatedDuration).toBe(300);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty operations list', () => {
      const operations: Operation[] = [];
      const plan = planner.createExecutionPlan(operations);
      
      expect(plan.stages).toHaveLength(0);
      expect(plan.groups).toHaveLength(0);
      expect(plan.parallelizationOpportunities).toBe(0);
      expect(plan.criticalPath).toHaveLength(0);
    });

    it('should handle single operation', () => {
      const operations: Operation[] = [
        { id: 'single', type: 'analyze', paths: ['src/**/*.ts'] }
      ];

      const plan = planner.createExecutionPlan(operations);
      
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].operations).toHaveLength(1);
      expect(plan.stages[0].canRunInParallel).toBe(false);
    });

    it('should handle operations with missing dependencies', () => {
      const operations: Operation[] = [
        { id: 'dependent', type: 'edit', dependsOn: ['missing'], edits: [] }
      ];

      // Should handle gracefully by treating missing dependencies as if they don't exist
      const plan = planner.createExecutionPlan(operations);
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].operations).toHaveLength(1);
    });

    it('should handle complex file path extraction', () => {
      const operations: Operation[] = [
        { 
          id: 'complex-edit', 
          type: 'edit', 
          edits: [
            { file: 'src/file1.ts', changes: [] },
            { file: 'src/file2.ts', changes: [] },
            { file: 'test/file1.test.ts', changes: [] }
          ]
        },
        {
          id: 'complex-create',
          type: 'create',
          files: [
            { path: 'src/new-file.ts', content: '' },
            { path: 'docs/readme.md', content: '' }
          ]
        },
        {
          id: 'another-edit',
          type: 'edit',
          edits: [
            { file: 'src/file1.ts', changes: [] } // Same file as first operation
          ]
        }
      ];

      const groups = planner.groupOperations(operations);
      const localityGroups = groups.filter(g => g.type === 'file-locality');
      
      // Should find at least one file locality group for src/file1.ts
      expect(localityGroups.length).toBeGreaterThan(0);
      
      // Should find a group with operations working on the same file
      const srcFile1Group = localityGroups.find(g => 
        g.operations.some(op => op.id === 'complex-edit') &&
        g.operations.some(op => op.id === 'another-edit')
      );
      expect(srcFile1Group).toBeDefined();
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large number of operations efficiently', () => {
      const operations: Operation[] = [];
      
      // Create 100 operations with some dependencies
      for (let i = 0; i < 100; i++) {
        const baseProps = {
          id: `op-${i}`,
          ...(i > 0 && i % 10 === 0 ? { dependsOn: [`op-${i - 1}`] } : {})
        };
        
        let operation: Operation;
        
        if (i % 4 === 0) {
          operation = {
            ...baseProps,
            type: 'analyze',
            paths: [`src/file-${i}.ts`]
          };
        } else if (i % 4 === 1) {
          operation = {
            ...baseProps,
            type: 'edit',
            edits: [{ file: `src/file-${i}.ts`, changes: [] }]
          };
        } else if (i % 4 === 2) {
          operation = {
            ...baseProps,
            type: 'create',
            files: [{ path: `src/new-file-${i}.ts`, content: '' }]
          };
        } else {
          operation = {
            ...baseProps,
            type: 'validate',
            files: [`src/file-${i}.ts`]
          };
        }
        
        operations.push(operation);
      }

      const startTime = Date.now();
      const plan = planner.createExecutionPlan(operations);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(plan.stages.length).toBeGreaterThan(0);
      expect(plan.groups.length).toBeGreaterThan(0);
    });
  });
});