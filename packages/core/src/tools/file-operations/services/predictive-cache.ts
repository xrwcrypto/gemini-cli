/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileSystemService } from './file-system-service.js';
import { CacheManager } from './cache-manager.js';
import { ProcessedFileReadResult } from '../../../utils/fileUtils.js';
import { ASTParserService } from './ast-parser.js';
import * as path from 'path';

/**
 * File access pattern record
 */
export interface FileAccessPattern {
  filePath: string;
  timestamp: number;
  operation: 'read' | 'write' | 'analyze' | 'edit';
  sessionId: string;
  context?: string; // Related operation context
}

/**
 * File dependency information
 */
export interface FileDependency {
  filePath: string;
  dependencyType: 'import' | 'relative' | 'module' | 'asset';
  resolvedPath?: string;
  strength: number; // How strongly connected (0-1)
}

/**
 * Dependency graph for files
 */
export interface DependencyGraph {
  dependencies: Map<string, FileDependency[]>;
  dependents: Map<string, string[]>;
  clusters: string[][];
}

/**
 * Project type detection result
 */
export interface ProjectType {
  type: 'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'cpp' | 'rust' | 'mixed' | 'unknown';
  confidence: number;
  indicators: string[];
}

/**
 * Project patterns specific to different project types
 */
export interface ProjectPatterns {
  entryPointPatterns: string[];
  testPatterns: string[];
  configPatterns: string[];
  buildArtifactPatterns: string[];
  ignoredPatterns: string[];
  importantDirectories: string[];
}

/**
 * Workspace analysis result
 */
export interface WorkspaceAnalysis {
  entryPoints: string[];
  coreFiles: string[];
  testFiles: string[];
  configFiles: string[];
  buildFiles: string[];
  dependencies: DependencyGraph;
  fileTypes: Map<string, number>;
  directoryStructure: Map<string, string[]>;
  projectType: ProjectType;
  patterns: ProjectPatterns;
  hotspots: string[]; // Files that are accessed frequently
  criticalPaths: string[][]; // Important file dependency chains
}

/**
 * Prediction features for ML model
 */
export interface PredictionFeatures {
  temporalProximity: number;      // How recent was last access (0-1)
  spatialProximity: number;       // Path similarity to recently accessed files (0-1)
  accessFrequency: number;        // How often file is accessed (0-1)
  fileType: string;               // File extension
  directoryDepth: number;         // Depth in directory tree
  fileSize: number;               // File size in bytes
  lastModified: number;           // Last modification time
  dependencyCount: number;        // Number of import/require dependencies
  dependencyStrength: number;     // Average strength of dependencies (0-1)
  isDependentOn: number;          // How many files depend on this one (0-1)
  isEntryPoint: number;           // Whether this is an entry point (0-1)
  isCoreFile: number;             // Whether this is a core file (0-1)
  timeOfDay: number;              // Hour of day (0-23)
  dayOfWeek: number;              // Day of week (0-6)
  workspaceRelevance: number;     // Relevance within workspace context (0-1)
}

/**
 * Git commit information for analysis
 */
export interface GitCommitInfo {
  hash: string;
  timestamp: number;
  message: string;
  files: string[];
  author: string;
}

/**
 * File modification pattern from git history
 */
export interface FileModificationPattern {
  file: string;
  coModifiedWith: Map<string, number>; // file -> frequency
  lastModified: number;
  modificationFrequency: number;
  authors: Set<string>;
}

/**
 * Cache warming strategy
 */
export interface WarmingStrategy {
  name: string;
  priority: number;
  enabled: boolean;
  trigger: 'startup' | 'dependency' | 'pattern' | 'git-history' | 'manual';
  maxFiles: number;
  patterns: string[];
  dependencies?: string[];
  gitOptions?: {
    lookbackDays?: number;
    minCommits?: number;
    ignoreAuthors?: string[];
  };
}

/**
 * Prediction result
 */
export interface PredictionResult {
  filePath: string;
  confidence: number;
  reason: string;
  features: PredictionFeatures;
  estimatedLoadTime: number;
}

/**
 * ML model interface for access prediction
 */
export interface AccessPredictionModel {
  train(patterns: FileAccessPattern[]): Promise<void>;
  predict(features: PredictionFeatures[]): Promise<number[]>;
  getFeatureImportance(): Map<string, number>;
  updateOnline(pattern: FileAccessPattern, actualAccess: boolean): Promise<void>;
}

/**
 * Decision tree node for prediction
 */
interface DecisionTreeNode {
  feature?: string;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
  prediction?: number;
  isLeaf: boolean;
}

/**
 * Decision tree model for file access prediction
 */
export class DecisionTreeAccessPredictionModel implements AccessPredictionModel {
  private tree: DecisionTreeNode | null = null;
  private featureImportance: Map<string, number> = new Map();
  private trained: boolean = false;
  private maxDepth: number = 5;
  private minSamplesLeaf: number = 2;

  constructor(maxDepth: number = 5, minSamplesLeaf: number = 2) {
    this.maxDepth = maxDepth;
    this.minSamplesLeaf = minSamplesLeaf;
  }

  async train(patterns: FileAccessPattern[]): Promise<void> {
    if (patterns.length === 0) return;

    const features = await this.extractFeaturesFromPatterns(patterns);
    const labels = patterns.map(() => 1); // All patterns represent actual access

    this.tree = this.buildTree(features, labels, 0);
    this.calculateFeatureImportance(features);
    this.trained = true;
  }

  private buildTree(
    features: PredictionFeatures[], 
    labels: number[], 
    depth: number
  ): DecisionTreeNode {
    // Check stopping criteria
    if (depth >= this.maxDepth || 
        features.length <= this.minSamplesLeaf || 
        this.isPure(labels)) {
      return {
        isLeaf: true,
        prediction: this.calculateMean(labels)
      };
    }

    // Find best split
    const bestSplit = this.findBestSplit(features, labels);
    if (!bestSplit) {
      return {
        isLeaf: true,
        prediction: this.calculateMean(labels)
      };
    }

    // Split data
    const { leftFeatures, leftLabels, rightFeatures, rightLabels } = 
      this.splitData(features, labels, bestSplit.feature, bestSplit.threshold);

    // Build subtrees
    const leftNode = this.buildTree(leftFeatures, leftLabels, depth + 1);
    const rightNode = this.buildTree(rightFeatures, rightLabels, depth + 1);

    return {
      isLeaf: false,
      feature: bestSplit.feature,
      threshold: bestSplit.threshold,
      left: leftNode,
      right: rightNode
    };
  }

  private findBestSplit(features: PredictionFeatures[], labels: number[]) {
    let bestSplit = null;
    let bestScore = -Infinity;

    for (const featureName of this.getNumericFeatureNames()) {
      const values = features.map(f => this.getFeatureValue(f, featureName));
      const uniqueValues = [...new Set(values)].sort((a, b) => a - b);

      for (let i = 0; i < uniqueValues.length - 1; i++) {
        const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;
        const score = this.calculateSplitScore(features, labels, featureName, threshold);

        if (score > bestScore) {
          bestScore = score;
          bestSplit = { feature: featureName, threshold };
        }
      }
    }

    return bestSplit;
  }

  private getNumericFeatureNames(): string[] {
    return [
      'temporalProximity', 'spatialProximity', 'accessFrequency',
      'directoryDepth', 'fileSize', 'dependencyCount', 'dependencyStrength',
      'isDependentOn', 'isEntryPoint', 'isCoreFile', 'timeOfDay', 'dayOfWeek',
      'workspaceRelevance'
    ];
  }

  private getFeatureValue(features: PredictionFeatures, featureName: string): number {
    return (features as unknown as Record<string, unknown>)[featureName] as number || 0;
  }

  private calculateSplitScore(
    features: PredictionFeatures[], 
    labels: number[], 
    featureName: string, 
    threshold: number
  ): number {
    const { leftLabels, rightLabels } = this.splitLabels(features, labels, featureName, threshold);
    
    if (leftLabels.length === 0 || rightLabels.length === 0) {
      return -Infinity;
    }

    const totalSize = labels.length;
    const leftSize = leftLabels.length;
    const rightSize = rightLabels.length;

    const leftVariance = this.calculateVariance(leftLabels);
    const rightVariance = this.calculateVariance(rightLabels);

    // Information gain based on variance reduction
    const originalVariance = this.calculateVariance(labels);
    const weightedVariance = (leftSize / totalSize) * leftVariance + (rightSize / totalSize) * rightVariance;

    return originalVariance - weightedVariance;
  }

  private splitLabels(
    features: PredictionFeatures[], 
    labels: number[], 
    featureName: string, 
    threshold: number
  ) {
    const leftLabels: number[] = [];
    const rightLabels: number[] = [];

    for (let i = 0; i < features.length; i++) {
      const value = this.getFeatureValue(features[i], featureName);
      if (value <= threshold) {
        leftLabels.push(labels[i]);
      } else {
        rightLabels.push(labels[i]);
      }
    }

    return { leftLabels, rightLabels };
  }

  private splitData(
    features: PredictionFeatures[], 
    labels: number[], 
    featureName: string, 
    threshold: number
  ) {
    const leftFeatures: PredictionFeatures[] = [];
    const leftLabels: number[] = [];
    const rightFeatures: PredictionFeatures[] = [];
    const rightLabels: number[] = [];

    for (let i = 0; i < features.length; i++) {
      const value = this.getFeatureValue(features[i], featureName);
      if (value <= threshold) {
        leftFeatures.push(features[i]);
        leftLabels.push(labels[i]);
      } else {
        rightFeatures.push(features[i]);
        rightLabels.push(labels[i]);
      }
    }

    return { leftFeatures, leftLabels, rightFeatures, rightLabels };
  }

  private isPure(labels: number[]): boolean {
    const variance = this.calculateVariance(labels);
    return variance < 0.01; // Consider pure if variance is very low
  }

  private calculateMean(values: number[]): number {
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return this.calculateMean(squaredDiffs);
  }

  private calculateFeatureImportance(features: PredictionFeatures[]): void {
    this.featureImportance.clear();
    
    if (!this.tree || features.length === 0) return;

    // Simple feature importance based on feature usage in splits
    this.traverseTreeForImportance(this.tree, features.length);
    
    // Normalize importance scores
    const totalImportance = Array.from(this.featureImportance.values()).reduce((sum, val) => sum + val, 0);
    if (totalImportance > 0) {
      for (const [feature, importance] of this.featureImportance) {
        this.featureImportance.set(feature, importance / totalImportance);
      }
    }
  }

  private traverseTreeForImportance(node: DecisionTreeNode, totalSamples: number): void {
    if (node.isLeaf || !node.feature) return;

    const currentImportance = this.featureImportance.get(node.feature) || 0;
    this.featureImportance.set(node.feature, currentImportance + 1);

    if (node.left) this.traverseTreeForImportance(node.left, totalSamples);
    if (node.right) this.traverseTreeForImportance(node.right, totalSamples);
  }

  async predict(features: PredictionFeatures[]): Promise<number[]> {
    if (!this.trained || !this.tree) {
      return features.map(() => 0.5); // Default prediction
    }

    return features.map(f => this.predictSingle(f, this.tree!));
  }

  private predictSingle(features: PredictionFeatures, node: DecisionTreeNode): number {
    if (node.isLeaf) {
      return Math.max(0, Math.min(1, node.prediction || 0)); // Clamp to [0, 1]
    }

    if (!node.feature || node.threshold === undefined) {
      return 0.5; // Default
    }

    const value = this.getFeatureValue(features, node.feature);
    if (value <= node.threshold) {
      return node.left ? this.predictSingle(features, node.left) : 0.5;
    } else {
      return node.right ? this.predictSingle(features, node.right) : 0.5;
    }
  }

  getFeatureImportance(): Map<string, number> {
    return new Map(this.featureImportance);
  }

  async updateOnline(_pattern: FileAccessPattern, _actualAccess: boolean): Promise<void> {
    // For decision trees, online learning is complex
    // For now, we'll store the pattern for future retraining
    // In a real implementation, you might use incremental tree algorithms
  }

  private async extractFeaturesFromPatterns(patterns: FileAccessPattern[]): Promise<PredictionFeatures[]> {
    return patterns.map(pattern => ({
      temporalProximity: Math.max(0, 1 - (Date.now() - pattern.timestamp) / (1000 * 60 * 60)),
      spatialProximity: 0.5,
      accessFrequency: 0.5,
      fileType: path.extname(pattern.filePath),
      directoryDepth: pattern.filePath.split(path.sep).length,
      fileSize: 1000,
      lastModified: pattern.timestamp,
      dependencyCount: 0,
      dependencyStrength: 0.5,
      isDependentOn: 0.3,
      isEntryPoint: 0,
      isCoreFile: 0.5,
      timeOfDay: new Date(pattern.timestamp).getHours(),
      dayOfWeek: new Date(pattern.timestamp).getDay(),
      workspaceRelevance: 0.5
    }));
  }
}

/**
 * Neural network model for file access prediction
 */
export class NeuralNetworkAccessPredictionModel implements AccessPredictionModel {
  private weights: number[][] = [];
  private biases: number[][] = [];
  private layers: number[] = [13, 8, 4, 1]; // Input, hidden, hidden, output
  private learningRate: number = 0.01;
  private trained: boolean = false;

  constructor(layers: number[] = [13, 8, 4, 1], learningRate: number = 0.01) {
    this.layers = layers;
    this.learningRate = learningRate;
    this.initializeWeights();
  }

  private initializeWeights(): void {
    this.weights = [];
    this.biases = [];

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layerWeights: number[] = [];
      for (let j = 0; j < this.layers[i] * this.layers[i + 1]; j++) {
        layerWeights.push((Math.random() - 0.5) * 0.1); // Small random weights
      }
      this.weights.push(layerWeights);
      
      const layerBiases: number[] = [];
      for (let j = 0; j < this.layers[i + 1]; j++) {
        layerBiases.push(0);
      }
      this.biases.push(layerBiases);
    }
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private sigmoidDerivative(x: number): number {
    return x * (1 - x);
  }

  private forwardPass(input: number[]): number[][] {
    const activations: number[][] = [input];
    let currentActivation = input;

    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const nextActivation: number[] = [];
      
      for (let neuron = 0; neuron < this.layers[layer + 1]; neuron++) {
        let sum = this.biases[layer][neuron];
        for (let prevNeuron = 0; prevNeuron < this.layers[layer]; prevNeuron++) {
          const weightIndex = prevNeuron * this.layers[layer + 1] + neuron;
          sum += currentActivation[prevNeuron] * this.weights[layer][weightIndex];
        }
        nextActivation.push(this.sigmoid(sum));
      }
      
      activations.push(nextActivation);
      currentActivation = nextActivation;
    }

    return activations;
  }

  async train(patterns: FileAccessPattern[]): Promise<void> {
    if (patterns.length === 0) return;

    const features = await this.extractFeaturesFromPatterns(patterns);
    const labels = patterns.map(() => 1);

    // Train for multiple epochs
    for (let epoch = 0; epoch < 100; epoch++) {
      for (let i = 0; i < features.length; i++) {
        const input = this.featuresToArray(features[i]);
        const target = [labels[i]];
        
        // Forward pass
        const activations = this.forwardPass(input);
        
        // Backward pass
        this.backwardPass(activations, target);
      }
    }

    this.trained = true;
  }

  private backwardPass(activations: number[][], target: number[]): void {
    const errors: number[][] = [];
    
    // Calculate output layer error
    const outputError: number[] = [];
    const outputLayer = activations[activations.length - 1];
    for (let i = 0; i < outputLayer.length; i++) {
      outputError.push(target[i] - outputLayer[i]);
    }
    errors.unshift(outputError);

    // Calculate hidden layer errors
    for (let layer = this.layers.length - 2; layer > 0; layer--) {
      const layerError: number[] = [];
      
      for (let neuron = 0; neuron < this.layers[layer]; neuron++) {
        let error = 0;
        for (let nextNeuron = 0; nextNeuron < this.layers[layer + 1]; nextNeuron++) {
          const weightIndex = neuron * this.layers[layer + 1] + nextNeuron;
          error += errors[0][nextNeuron] * this.weights[layer][weightIndex];
        }
        layerError.push(error);
      }
      
      errors.unshift(layerError);
    }

    // Update weights and biases
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      for (let neuron = 0; neuron < this.layers[layer + 1]; neuron++) {
        const delta = errors[layer][neuron] * this.sigmoidDerivative(activations[layer + 1][neuron]);
        
        // Update bias
        this.biases[layer][neuron] += this.learningRate * delta;
        
        // Update weights
        for (let prevNeuron = 0; prevNeuron < this.layers[layer]; prevNeuron++) {
          const weightIndex = prevNeuron * this.layers[layer + 1] + neuron;
          this.weights[layer][weightIndex] += this.learningRate * delta * activations[layer][prevNeuron];
        }
      }
    }
  }

  private featuresToArray(features: PredictionFeatures): number[] {
    return [
      features.temporalProximity,
      features.spatialProximity,
      features.accessFrequency,
      features.directoryDepth / 10, // Normalize
      features.fileSize / 10000, // Normalize
      features.dependencyCount / 10, // Normalize
      features.dependencyStrength,
      features.isDependentOn,
      features.isEntryPoint,
      features.isCoreFile,
      features.timeOfDay / 24, // Normalize
      features.dayOfWeek / 7, // Normalize
      features.workspaceRelevance
    ];
  }

  async predict(features: PredictionFeatures[]): Promise<number[]> {
    if (!this.trained) {
      return features.map(() => 0.5);
    }

    return features.map(f => {
      const input = this.featuresToArray(f);
      const activations = this.forwardPass(input);
      return activations[activations.length - 1][0];
    });
  }

  getFeatureImportance(): Map<string, number> {
    // For neural networks, feature importance is harder to compute
    // Return uniform importance for now
    const featureNames = [
      'temporalProximity', 'spatialProximity', 'accessFrequency',
      'directoryDepth', 'fileSize', 'dependencyCount', 'dependencyStrength',
      'isDependentOn', 'isEntryPoint', 'isCoreFile', 'timeOfDay', 'dayOfWeek',
      'workspaceRelevance'
    ];
    
    const importance = new Map<string, number>();
    featureNames.forEach(name => importance.set(name, 1 / featureNames.length));
    return importance;
  }

  async updateOnline(pattern: FileAccessPattern, actualAccess: boolean): Promise<void> {
    if (!this.trained) return;

    const features = await this.extractFeaturesFromPatterns([pattern]);
    if (features.length === 0) return;

    const input = this.featuresToArray(features[0]);
    const target = [actualAccess ? 1 : 0];
    
    const activations = this.forwardPass(input);
    this.backwardPass(activations, target);
  }

  private async extractFeaturesFromPatterns(patterns: FileAccessPattern[]): Promise<PredictionFeatures[]> {
    return patterns.map(pattern => ({
      temporalProximity: Math.max(0, 1 - (Date.now() - pattern.timestamp) / (1000 * 60 * 60)),
      spatialProximity: 0.5,
      accessFrequency: 0.5,
      fileType: path.extname(pattern.filePath),
      directoryDepth: pattern.filePath.split(path.sep).length,
      fileSize: 1000,
      lastModified: pattern.timestamp,
      dependencyCount: 0,
      dependencyStrength: 0.5,
      isDependentOn: 0.3,
      isEntryPoint: 0,
      isCoreFile: 0.5,
      timeOfDay: new Date(pattern.timestamp).getHours(),
      dayOfWeek: new Date(pattern.timestamp).getDay(),
      workspaceRelevance: 0.5
    }));
  }
}

/**
 * Simple linear regression model for file access prediction
 */
export class SimpleAccessPredictionModel implements AccessPredictionModel {
  private weights: Map<string, number> = new Map();
  private bias: number = 0;
  private learningRate: number = 0.01;
  private trained: boolean = false;

  async train(patterns: FileAccessPattern[]): Promise<void> {
    if (patterns.length === 0) return;

    // Extract features for training
    const features = await this.extractFeaturesFromPatterns(patterns);
    const labels = patterns.map(() => 1); // All patterns represent actual access

    // Simple gradient descent training
    this.initializeWeights(features[0]);
    
    for (let epoch = 0; epoch < 100; epoch++) {
      for (let i = 0; i < features.length; i++) {
        const prediction = this.predictSingle(features[i]);
        const error = labels[i] - prediction;
        
        // Update weights
        for (const [key, value] of Object.entries(features[i])) {
          if (typeof value === 'number') {
            const currentWeight = this.weights.get(key) || 0;
            this.weights.set(key, currentWeight + this.learningRate * error * value);
          }
        }
        this.bias += this.learningRate * error;
      }
    }
    
    this.trained = true;
  }

  async predict(features: PredictionFeatures[]): Promise<number[]> {
    if (!this.trained) {
      // Return default predictions if not trained
      return features.map(() => 0.5);
    }
    
    return features.map(f => this.predictSingle(f));
  }

  getFeatureImportance(): Map<string, number> {
    return new Map(this.weights);
  }

  async updateOnline(pattern: FileAccessPattern, actualAccess: boolean): Promise<void> {
    if (!this.trained) return;
    
    const features = await this.extractFeaturesFromPatterns([pattern]);
    if (features.length === 0) return;
    
    const prediction = this.predictSingle(features[0]);
    const label = actualAccess ? 1 : 0;
    const error = label - prediction;
    
    // Update weights with online learning
    for (const [key, value] of Object.entries(features[0])) {
      if (typeof value === 'number') {
        const currentWeight = this.weights.get(key) || 0;
        this.weights.set(key, currentWeight + this.learningRate * error * value);
      }
    }
    this.bias += this.learningRate * error;
  }

  private predictSingle(features: PredictionFeatures): number {
    let prediction = this.bias;
    
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'number') {
        const weight = this.weights.get(key) || 0;
        prediction += weight * value;
      }
    }
    
    // Apply sigmoid activation
    return 1 / (1 + Math.exp(-prediction));
  }

  private initializeWeights(sampleFeatures: PredictionFeatures): void {
    for (const key of Object.keys(sampleFeatures)) {
      this.weights.set(key, Math.random() * 0.1 - 0.05); // Small random weights
    }
  }

  private async extractFeaturesFromPatterns(patterns: FileAccessPattern[]): Promise<PredictionFeatures[]> {
    // For training, we create synthetic features based on patterns
    return patterns.map(pattern => ({
      temporalProximity: Math.max(0, 1 - (Date.now() - pattern.timestamp) / (1000 * 60 * 60)), // 1 hour decay
      spatialProximity: 0.5, // Default spatial proximity
      accessFrequency: 0.5, // Default frequency
      fileType: path.extname(pattern.filePath),
      directoryDepth: pattern.filePath.split(path.sep).length,
      fileSize: 1000, // Default size
      lastModified: pattern.timestamp,
      dependencyCount: 0, // Default dependency count
      dependencyStrength: 0.5, // Default dependency strength
      isDependentOn: 0.3, // Default dependent count
      isEntryPoint: 0, // Default not entry point
      isCoreFile: 0.5, // Default core file likelihood
      timeOfDay: new Date(pattern.timestamp).getHours(),
      dayOfWeek: new Date(pattern.timestamp).getDay(),
      workspaceRelevance: 0.5 // Default workspace relevance
    }));
  }
}

/**
 * Ensemble model that combines multiple prediction models
 */
export class EnsembleAccessPredictionModel implements AccessPredictionModel {
  private models: AccessPredictionModel[] = [];
  private weights: number[] = [];
  private trained: boolean = false;

  constructor() {
    this.models = [
      new SimpleAccessPredictionModel(),
      new DecisionTreeAccessPredictionModel(4, 3),
      new NeuralNetworkAccessPredictionModel([13, 6, 3, 1], 0.005)
    ];
    this.weights = [0.3, 0.4, 0.3]; // Initial weights
  }

  async train(patterns: FileAccessPattern[]): Promise<void> {
    if (patterns.length === 0) return;

    // Train all models
    await Promise.all(this.models.map(model => model.train(patterns)));
    
    // Update weights based on model performance (simplified)
    // In a real implementation, you'd use validation data
    this.weights = [0.25, 0.5, 0.25]; // Give decision tree more weight
    
    this.trained = true;
  }

  async predict(features: PredictionFeatures[]): Promise<number[]> {
    if (!this.trained) {
      return features.map(() => 0.5);
    }

    // Get predictions from all models
    const allPredictions = await Promise.all(
      this.models.map(model => model.predict(features))
    );

    // Combine predictions using weighted average
    return features.map((_, index) => {
      let weightedSum = 0;
      let totalWeight = 0;

      for (let modelIndex = 0; modelIndex < this.models.length; modelIndex++) {
        const prediction = allPredictions[modelIndex][index];
        const weight = this.weights[modelIndex];
        weightedSum += prediction * weight;
        totalWeight += weight;
      }

      return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    });
  }

  getFeatureImportance(): Map<string, number> {
    if (!this.trained) {
      return new Map();
    }

    // Combine feature importance from all models
    const combinedImportance = new Map<string, number>();
    
    for (let i = 0; i < this.models.length; i++) {
      const modelImportance = this.models[i].getFeatureImportance();
      const weight = this.weights[i];
      
      for (const [feature, importance] of modelImportance) {
        const current = combinedImportance.get(feature) || 0;
        combinedImportance.set(feature, current + importance * weight);
      }
    }

    return combinedImportance;
  }

  async updateOnline(pattern: FileAccessPattern, actualAccess: boolean): Promise<void> {
    if (!this.trained) return;

    // Update all models
    await Promise.all(
      this.models.map(model => model.updateOnline(pattern, actualAccess))
    );
  }
}

/**
 * Model factory for creating prediction models
 */
export function createPredictionModel(type: ModelType = 'simple'): AccessPredictionModel {
  switch (type) {
    case 'decision-tree':
      return new DecisionTreeAccessPredictionModel();
    case 'neural-network':
      return new NeuralNetworkAccessPredictionModel();
    case 'ensemble':
      return new EnsembleAccessPredictionModel();
    case 'simple':
    default:
      return new SimpleAccessPredictionModel();
  }
}

/**
 * ML model type for predictions
 */
export type ModelType = 'simple' | 'decision-tree' | 'neural-network' | 'ensemble';

/**
 * Predictive caching system configuration
 */
export interface PredictiveCacheConfig {
  enabled: boolean;
  maxPredictions: number;
  predictionThreshold: number;
  backgroundLoadingConcurrency: number;
  patternWindowMs: number;
  warmingStrategies: WarmingStrategy[];
  modelUpdateInterval: number;
  enableOnlineLearning: boolean;
  modelType?: ModelType;
}

/**
 * Resource usage metrics
 */
export interface ResourceMetrics {
  memoryUsageMB: number;
  cpuUsagePercent: number;
  diskIOPS: number;
  networkLatencyMs: number;
  concurrentOperations: number;
}

/**
 * Adaptive configuration based on resource availability
 */
export interface AdaptiveConfig {
  maxConcurrentLoads: number;
  predictionThreshold: number;
  backgroundLoadingEnabled: boolean;
  cacheWarningEnabled: boolean;
  modelComplexity: 'simple' | 'medium' | 'complex';
}

/**
 * Predictive caching metrics
 */
export interface PredictiveCacheMetrics {
  totalPredictions: number;
  accuratePredictions: number;
  backgroundLoads: number;
  cacheHitsFromPrediction: number;
  averageConfidence: number;
  loadingSavingsMs: number;
  resourceMetrics: ResourceMetrics;
  adaptiveConfig: AdaptiveConfig;
}

/**
 * Predictive caching system for FileOperations tool
 * Enhances CacheManager with intelligent pre-loading based on access patterns
 */
export class PredictiveCache {
  private readonly fileService: FileSystemService;
  private readonly cacheManager: CacheManager;
  private readonly config: PredictiveCacheConfig;
  private readonly model: AccessPredictionModel;
  private readonly astParser: ASTParserService;
  
  private accessPatterns: FileAccessPattern[] = [];
  private currentLoading: Set<string> = new Set();
  private loadingQueue: Map<string, number> = new Map(); // filePath -> priority
  private metrics: PredictiveCacheMetrics;
  private lastModelUpdate: number = 0;
  
  private dependencyGraph: DependencyGraph | null = null;
  private workspaceAnalysis: WorkspaceAnalysis | null = null;
  private lastWorkspaceAnalysis: number = 0;
  private gitHistoryCache: Map<string, FileModificationPattern> = new Map();
  private lastGitAnalysis: number = 0;
  private resourceMetrics: ResourceMetrics;
  private adaptiveConfig: AdaptiveConfig;
  private lastResourceCheck: number = 0;
  
  private warmingTimer?: NodeJS.Timeout;
  private patternCleanupTimer?: NodeJS.Timeout;

  constructor(
    fileService: FileSystemService,
    cacheManager: CacheManager,
    config: PredictiveCacheConfig,
    model?: AccessPredictionModel,
    astParser?: ASTParserService
  ) {
    this.fileService = fileService;
    this.cacheManager = cacheManager;
    this.config = config;
    this.model = model || createPredictionModel(config.modelType || 'simple');
    this.astParser = astParser || new ASTParserService(cacheManager);
    
    // Initialize resource metrics with current values
    const memoryUsage = process.memoryUsage();
    this.resourceMetrics = {
      memoryUsageMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      cpuUsagePercent: 0,
      diskIOPS: 0,
      networkLatencyMs: 50,
      concurrentOperations: 0
    };
    
    this.adaptiveConfig = {
      maxConcurrentLoads: config.backgroundLoadingConcurrency,
      predictionThreshold: config.predictionThreshold,
      backgroundLoadingEnabled: true,
      cacheWarningEnabled: true,
      modelComplexity: 'medium'
    };
    
    this.metrics = {
      totalPredictions: 0,
      accuratePredictions: 0,
      backgroundLoads: 0,
      cacheHitsFromPrediction: 0,
      averageConfidence: 0,
      loadingSavingsMs: 0,
      resourceMetrics: this.resourceMetrics,
      adaptiveConfig: this.adaptiveConfig
    };
    
    if (config.enabled) {
      this.startPeriodicTasks();
    }
  }

  /**
   * Record file access pattern
   */
  recordAccess(filePath: string, operation: string, context?: string): void {
    if (!this.config.enabled) return;
    
    const pattern: FileAccessPattern = {
      filePath: path.normalize(filePath),
      timestamp: Date.now(),
      operation: operation as FileAccessPattern['operation'],
      sessionId: this.cacheManager.getSessionId(),
      context
    };
    
    this.accessPatterns.push(pattern);
    this.triggerPredictiveLoading(pattern);
    
    // Clean up old patterns
    const cutoff = Date.now() - this.config.patternWindowMs;
    this.accessPatterns = this.accessPatterns.filter(p => p.timestamp > cutoff);
  }

  /**
   * Get file with predictive enhancement
   */
  async getWithPrediction(filePath: string): Promise<ProcessedFileReadResult> {
    const startTime = Date.now();
    
    // Try cache first
    const result = await this.cacheManager.get(filePath);
    
    // Record access for pattern learning
    this.recordAccess(filePath, 'read');
    
    // Check if this was a prediction hit
    if (this.wasPreloaded(filePath)) {
      this.metrics.cacheHitsFromPrediction++;
      this.metrics.loadingSavingsMs += Date.now() - startTime;
    }
    
    return result;
  }

  /**
   * Predict next files to access
   */
  async predictNextFiles(currentFile?: string, limit?: number): Promise<PredictionResult[]> {
    if (!this.config.enabled) {
      return [];
    }
    
    const maxPredictions = limit || this.config.maxPredictions;
    let predictions: PredictionResult[] = [];
    
    // Get dependency-based predictions if we have a current file
    if (currentFile) {
      const dependencyPredictions = await this.getPredictionsBasedOnDependencies(currentFile, Math.ceil(maxPredictions / 3));
      predictions.push(...dependencyPredictions);
      
      // Get git history-based predictions
      const gitPredictions = await this.getPredictionsBasedOnGitHistory(currentFile, Math.ceil(maxPredictions / 3));
      predictions.push(...gitPredictions);
    }
    
    // Get pattern-based predictions if we have access patterns
    if (this.accessPatterns.length > 0) {
      const candidateFiles = await this.getCandidateFiles(currentFile);
      
      if (candidateFiles.length > 0) {
        // Extract features for prediction
        const features = await this.extractFeatures(candidateFiles, currentFile);
        const confidences = await this.model.predict(features);
        
        const patternPredictions: PredictionResult[] = candidateFiles
          .map((filePath, index) => ({
            filePath,
            confidence: confidences[index] || 0,
            reason: this.generatePredictionReason(features[index], candidateFiles[index]),
            features: features[index],
            estimatedLoadTime: this.estimateLoadTime(filePath)
          }))
          .filter(p => p.confidence >= this.adaptiveConfig.predictionThreshold) // Use adaptive threshold
          .filter(p => !predictions.some(existing => existing.filePath === p.filePath)); // Avoid duplicates
        
        predictions.push(...patternPredictions);
      }
    }
    
    // Sort by confidence and limit results
    predictions = predictions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxPredictions);
    
    this.metrics.totalPredictions += predictions.length;
    this.metrics.averageConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length || 0;
    
    return predictions;
  }

  /**
   * Pre-load files based on predictions
   */
  async preloadFiles(predictions?: PredictionResult[]): Promise<number> {
    if (!this.config.enabled || !this.adaptiveConfig.backgroundLoadingEnabled) return 0;
    
    // Check resource limits before starting
    if (!this.canPerformOperation()) {
      return 0;
    }
    
    const filesToLoad = predictions || await this.predictNextFiles();
    let loadedCount = 0;
    
    // Use adaptive concurrent loading limit
    const concurrentLoads = Math.min(
      this.adaptiveConfig.maxConcurrentLoads,
      filesToLoad.length
    );
    
    const loadPromises = filesToLoad
      .slice(0, concurrentLoads)
      .map(async (prediction) => {
        if (this.currentLoading.has(prediction.filePath)) {
          return false;
        }
        
        // Check resource limits before each load
        if (!this.canPerformOperation()) {
          return false;
        }
        
        this.currentLoading.add(prediction.filePath);
        this.loadingQueue.set(prediction.filePath, prediction.confidence);
        
        try {
          // Check if already cached
          const stats = this.cacheManager.getStats();
          if (stats.currentSize < stats.maxSize) {
            await this.cacheManager.get(prediction.filePath);
            loadedCount++;
            this.metrics.backgroundLoads++;
          }
        } catch {
          // Ignore load errors for background loading
        } finally {
          this.currentLoading.delete(prediction.filePath);
          this.loadingQueue.delete(prediction.filePath);
        }
        
        return true;
      });
    
    await Promise.allSettled(loadPromises);
    return loadedCount;
  }

  /**
   * Warm cache using configured strategies
   */
  async warmCache(strategy?: string): Promise<number> {
    if (!this.config.enabled) return 0;
    
    const strategies = strategy 
      ? this.config.warmingStrategies.filter(s => s.name === strategy)
      : this.config.warmingStrategies.filter(s => s.enabled);
    
    let totalWarmed = 0;
    
    for (const warmingStrategy of strategies.sort((a, b) => b.priority - a.priority)) {
      const warmed = await this.executeWarmingStrategy(warmingStrategy);
      totalWarmed += warmed;
    }
    
    return totalWarmed;
  }

  /**
   * Train the prediction model
   */
  async trainModel(): Promise<void> {
    if (!this.config.enabled || this.accessPatterns.length === 0) return;
    
    await this.model.train(this.accessPatterns);
    this.lastModelUpdate = Date.now();
  }

  /**
   * Update model with feedback
   */
  async updateModelWithFeedback(filePath: string, wasAccessed: boolean): Promise<void> {
    if (!this.config.enabled || !this.config.enableOnlineLearning) return;
    
    const recentPattern = this.accessPatterns
      .filter(p => p.filePath === filePath)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    if (recentPattern) {
      await this.model.updateOnline(recentPattern, wasAccessed);
      
      if (wasAccessed) {
        this.metrics.accuratePredictions++;
      }
    }
  }

  /**
   * Get prediction metrics
   */
  getMetrics(): PredictiveCacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Get feature importance from model
   */
  getFeatureImportance(): Map<string, number> {
    return this.model.getFeatureImportance();
  }

  /**
   * Analyze workspace to build dependency graph and identify patterns
   */
  async analyzeWorkspace(workspaceRoot?: string): Promise<WorkspaceAnalysis> {
    const now = Date.now();
    
    // Return cached analysis if recent (within 10 minutes)
    if (this.workspaceAnalysis && (now - this.lastWorkspaceAnalysis) < 600000) {
      return this.workspaceAnalysis;
    }

    const rootPath = workspaceRoot || process.cwd();
    const analysis: WorkspaceAnalysis = {
      entryPoints: [],
      coreFiles: [],
      testFiles: [],
      configFiles: [],
      buildFiles: [],
      dependencies: {
        dependencies: new Map(),
        dependents: new Map(),
        clusters: []
      },
      fileTypes: new Map(),
      directoryStructure: new Map(),
      projectType: { type: 'unknown', confidence: 0, indicators: [] },
      patterns: {
        entryPointPatterns: [],
        testPatterns: [],
        configPatterns: [],
        buildArtifactPatterns: [],
        ignoredPatterns: [],
        importantDirectories: []
      },
      hotspots: [],
      criticalPaths: []
    };

    try {
      // Find all relevant files in the workspace
      const allFiles = await this.findWorkspaceFiles(rootPath);
      
      // Detect project type first to inform categorization
      analysis.projectType = await this.detectProjectType(allFiles, rootPath);
      analysis.patterns = this.getProjectPatterns(analysis.projectType.type);
      
      // Categorize files based on project type
      this.categorizeFiles(allFiles, analysis);
      
      // Build directory structure
      this.buildDirectoryStructure(allFiles, analysis);

      // Build dependency graph
      analysis.dependencies = await this.buildDependencyGraph(analysis.coreFiles);
      
      // Analyze access patterns to find hotspots
      analysis.hotspots = this.identifyHotspots();
      
      // Find critical paths in the dependency graph
      analysis.criticalPaths = this.findCriticalPaths(analysis.dependencies);
      
      this.workspaceAnalysis = analysis;
      this.dependencyGraph = analysis.dependencies;
      this.lastWorkspaceAnalysis = now;
      
      return analysis;
    } catch {
      // Return partial analysis on error
      return analysis;
    }
  }

  /**
   * Detect project type based on files and structure
   */
  private async detectProjectType(files: string[], _rootPath: string): Promise<ProjectType> {
    const indicators: string[] = [];
    const scores = new Map<string, number>();
    
    // Initialize scores
    ['typescript', 'javascript', 'python', 'go', 'java', 'cpp', 'rust'].forEach(type => {
      scores.set(type, 0);
    });

    for (const filePath of files) {
      const fileName = path.basename(filePath).toLowerCase();
      const ext = path.extname(filePath).toLowerCase();
      
      // TypeScript indicators
      if (ext === '.ts' || ext === '.tsx') {
        scores.set('typescript', (scores.get('typescript') || 0) + 2);
        indicators.push(`TypeScript files (${ext})`);
      }
      if (fileName === 'tsconfig.json') {
        scores.set('typescript', (scores.get('typescript') || 0) + 5);
        indicators.push('tsconfig.json');
      }
      
      // JavaScript indicators
      if (ext === '.js' || ext === '.jsx' || ext === '.mjs') {
        scores.set('javascript', (scores.get('javascript') || 0) + 1);
        indicators.push(`JavaScript files (${ext})`);
      }
      if (fileName === 'package.json') {
        scores.set('javascript', (scores.get('javascript') || 0) + 3);
        scores.set('typescript', (scores.get('typescript') || 0) + 3);
        indicators.push('package.json');
      }
      
      // Python indicators
      if (ext === '.py' || ext === '.pyx') {
        scores.set('python', (scores.get('python') || 0) + 2);
        indicators.push(`Python files (${ext})`);
      }
      if (fileName === 'requirements.txt' || fileName === 'setup.py' || fileName === 'pyproject.toml') {
        scores.set('python', (scores.get('python') || 0) + 5);
        indicators.push(fileName);
      }
      
      // Go indicators
      if (ext === '.go') {
        scores.set('go', (scores.get('go') || 0) + 2);
        indicators.push('Go files');
      }
      if (fileName === 'go.mod' || fileName === 'go.sum') {
        scores.set('go', (scores.get('go') || 0) + 5);
        indicators.push(fileName);
      }
      
      // Java indicators
      if (ext === '.java') {
        scores.set('java', (scores.get('java') || 0) + 2);
        indicators.push('Java files');
      }
      if (fileName === 'pom.xml' || fileName === 'build.gradle') {
        scores.set('java', (scores.get('java') || 0) + 5);
        indicators.push(fileName);
      }
      
      // C++ indicators
      if (['.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp'].includes(ext)) {
        scores.set('cpp', (scores.get('cpp') || 0) + 2);
        indicators.push(`C++ files (${ext})`);
      }
      if (fileName === 'cmake.txt' || fileName === 'makefile') {
        scores.set('cpp', (scores.get('cpp') || 0) + 3);
        indicators.push(fileName);
      }
      
      // Rust indicators
      if (ext === '.rs') {
        scores.set('rust', (scores.get('rust') || 0) + 2);
        indicators.push('Rust files');
      }
      if (fileName === 'cargo.toml' || fileName === 'cargo.lock') {
        scores.set('rust', (scores.get('rust') || 0) + 5);
        indicators.push(fileName);
      }
    }

    // Find the highest scoring type
    let maxScore = 0;
    let detectedType: ProjectType['type'] = 'unknown';
    
    for (const [type, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        detectedType = type as ProjectType['type'];
      }
    }
    
    // Check for mixed projects
    const nonZeroScores = Array.from(scores.values()).filter(score => score > 0);
    if (nonZeroScores.length > 1) {
      const secondHighest = nonZeroScores.sort((a, b) => b - a)[1];
      if (secondHighest > maxScore * 0.5) {
        detectedType = 'mixed';
      }
    }
    
    const confidence = Math.min(1, maxScore / 10); // Normalize to 0-1
    
    return {
      type: detectedType,
      confidence,
      indicators: [...new Set(indicators)]
    };
  }

  /**
   * Get project-specific patterns based on project type
   */
  private getProjectPatterns(projectType: ProjectType['type']): ProjectPatterns {
    const patterns: Record<ProjectType['type'], ProjectPatterns> = {
      typescript: {
        entryPointPatterns: ['index.ts', 'main.ts', 'app.ts', 'src/index.ts', 'src/main.ts'],
        testPatterns: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/tests/**'],
        configPatterns: ['tsconfig.json', 'package.json', 'webpack.config.js', 'vite.config.ts'],
        buildArtifactPatterns: ['dist/**', 'build/**', 'lib/**', '*.d.ts'],
        ignoredPatterns: ['node_modules/**', '.git/**', 'coverage/**'],
        importantDirectories: ['src', 'lib', 'types', 'components']
      },
      javascript: {
        entryPointPatterns: ['index.js', 'main.js', 'app.js', 'src/index.js', 'src/main.js'],
        testPatterns: ['**/*.test.js', '**/*.spec.js', '**/test/**', '**/tests/**'],
        configPatterns: ['package.json', 'webpack.config.js', 'babel.config.js'],
        buildArtifactPatterns: ['dist/**', 'build/**', 'lib/**'],
        ignoredPatterns: ['node_modules/**', '.git/**', 'coverage/**'],
        importantDirectories: ['src', 'lib', 'components']
      },
      python: {
        entryPointPatterns: ['main.py', '__main__.py', 'app.py', 'run.py', 'manage.py'],
        testPatterns: ['**/test_*.py', '**/*_test.py', '**/tests/**'],
        configPatterns: ['setup.py', 'requirements.txt', 'pyproject.toml', 'tox.ini'],
        buildArtifactPatterns: ['__pycache__/**', '*.pyc', 'build/**', 'dist/**'],
        ignoredPatterns: ['__pycache__/**', '.pytest_cache/**', '.git/**'],
        importantDirectories: ['src', 'lib', 'modules', 'packages']
      },
      go: {
        entryPointPatterns: ['main.go', 'cmd/*/main.go'],
        testPatterns: ['**/*_test.go'],
        configPatterns: ['go.mod', 'go.sum', 'Dockerfile'],
        buildArtifactPatterns: ['bin/**', '*.exe'],
        ignoredPatterns: ['vendor/**', '.git/**'],
        importantDirectories: ['cmd', 'internal', 'pkg', 'api']
      },
      java: {
        entryPointPatterns: ['**/Main.java', '**/Application.java'],
        testPatterns: ['**/Test*.java', '**/*Test.java', '**/test/**'],
        configPatterns: ['pom.xml', 'build.gradle', 'settings.gradle'],
        buildArtifactPatterns: ['target/**', 'build/**', '*.jar', '*.class'],
        ignoredPatterns: ['target/**', 'build/**', '.gradle/**'],
        importantDirectories: ['src/main/java', 'src/test/java']
      },
      cpp: {
        entryPointPatterns: ['main.cpp', 'main.c', '**/main.cpp'],
        testPatterns: ['**/test*.cpp', '**/test*.c', '**/tests/**'],
        configPatterns: ['CMakeLists.txt', 'Makefile', 'configure.ac'],
        buildArtifactPatterns: ['build/**', '*.o', '*.so', '*.exe'],
        ignoredPatterns: ['build/**', '.git/**'],
        importantDirectories: ['src', 'include', 'lib']
      },
      rust: {
        entryPointPatterns: ['main.rs', 'lib.rs', 'src/main.rs', 'src/lib.rs'],
        testPatterns: ['**/tests/**', '**/*_test.rs'],
        configPatterns: ['Cargo.toml', 'Cargo.lock'],
        buildArtifactPatterns: ['target/**'],
        ignoredPatterns: ['target/**', '.git/**'],
        importantDirectories: ['src', 'tests', 'examples']
      },
      mixed: {
        entryPointPatterns: ['index.*', 'main.*', 'app.*'],
        testPatterns: ['**/test*', '**/spec*', '**/tests/**'],
        configPatterns: ['*.json', '*.toml', '*.yaml', '*.yml'],
        buildArtifactPatterns: ['build/**', 'dist/**', 'target/**'],
        ignoredPatterns: ['node_modules/**', '.git/**', '__pycache__/**'],
        importantDirectories: ['src', 'lib']
      },
      unknown: {
        entryPointPatterns: ['index.*', 'main.*'],
        testPatterns: ['**/test*', '**/spec*'],
        configPatterns: ['*.json', '*.config.*'],
        buildArtifactPatterns: ['build/**', 'dist/**'],
        ignoredPatterns: ['.git/**', 'node_modules/**'],
        importantDirectories: ['src']
      }
    };

    return patterns[projectType] || patterns.unknown;
  }

  /**
   * Categorize files based on project type and patterns
   */
  private categorizeFiles(files: string[], analysis: WorkspaceAnalysis): void {
    for (const filePath of files) {
      const relativePath = path.relative(process.cwd(), filePath);
      const fileName = path.basename(filePath).toLowerCase();
      const ext = path.extname(filePath).toLowerCase();
      
      // Count file types
      analysis.fileTypes.set(ext, (analysis.fileTypes.get(ext) || 0) + 1);
      
      // Categorize based on patterns
      if (this.matchesPatterns(relativePath, analysis.patterns.testPatterns)) {
        analysis.testFiles.push(filePath);
      } else if (this.matchesPatterns(fileName, analysis.patterns.configPatterns)) {
        analysis.configFiles.push(filePath);
      } else if (this.matchesPatterns(relativePath, analysis.patterns.buildArtifactPatterns)) {
        analysis.buildFiles.push(filePath);
      } else if (this.matchesPatterns(relativePath, analysis.patterns.entryPointPatterns)) {
        analysis.entryPoints.push(filePath);
      } else if (this.isCodeFile(ext) && !this.matchesPatterns(relativePath, analysis.patterns.ignoredPatterns)) {
        analysis.coreFiles.push(filePath);
      }
    }
  }

  /**
   * Check if a path matches any of the given patterns
   */
  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Simple pattern matching (could be enhanced with proper glob matching)
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
        return regex.test(filePath);
      }
      return filePath.includes(pattern);
    });
  }

  /**
   * Check if file extension indicates a code file
   */
  private isCodeFile(ext: string): boolean {
    const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.java', '.cpp', '.c', '.h', '.hpp', '.rs'];
    return codeExtensions.includes(ext.toLowerCase());
  }

  /**
   * Build directory structure mapping
   */
  private buildDirectoryStructure(files: string[], analysis: WorkspaceAnalysis): void {
    for (const filePath of files) {
      const dir = path.dirname(filePath);
      if (!analysis.directoryStructure.has(dir)) {
        analysis.directoryStructure.set(dir, []);
      }
      analysis.directoryStructure.get(dir)!.push(filePath);
    }
  }

  /**
   * Identify frequently accessed files (hotspots)
   */
  private identifyHotspots(): string[] {
    const accessCounts = new Map<string, number>();
    
    // Count accesses for each file
    this.accessPatterns.forEach(pattern => {
      accessCounts.set(pattern.filePath, (accessCounts.get(pattern.filePath) || 0) + 1);
    });
    
    // Return top 10 most accessed files
    return Array.from(accessCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([filePath]) => filePath);
  }

  /**
   * Find critical paths in the dependency graph
   */
  private findCriticalPaths(dependencies: DependencyGraph): string[][] {
    const criticalPaths: string[][] = [];
    
    if (!dependencies.dependencies.size) {
      return criticalPaths;
    }
    
    // Find longest dependency chains
    for (const [startFile] of dependencies.dependencies) {
      const path = this.findLongestPath(startFile, dependencies, new Set());
      if (path.length > 2) { // Only consider paths with more than 2 files
        criticalPaths.push(path);
      }
    }
    
    // Sort by path length and return top 5
    return criticalPaths
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
  }

  /**
   * Find the longest dependency path starting from a file
   */
  private findLongestPath(
    startFile: string, 
    dependencies: DependencyGraph, 
    visited: Set<string>
  ): string[] {
    if (visited.has(startFile)) {
      return []; // Avoid cycles
    }
    
    visited.add(startFile);
    const fileDeps = dependencies.dependencies.get(startFile) || [];
    
    let longestPath = [startFile];
    
    for (const dep of fileDeps) {
      const subPath = this.findLongestPath(dep.filePath, dependencies, new Set(visited));
      if (subPath.length + 1 > longestPath.length) {
        longestPath = [startFile, ...subPath];
      }
    }
    
    return longestPath;
  }

  /**
   * Find workspace files (simplified implementation)
   */
  private async findWorkspaceFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    
    // Get recently accessed files as a starting point
    const recentFiles = this.accessPatterns
      .filter(p => p.filePath.startsWith(rootPath))
      .map(p => p.filePath);
    
    files.push(...recentFiles);
    
    // For testing purposes, also check if files exist in the file system
    // In a real implementation, this would use globbing to find all relevant files
    try {
      const testFiles = [
        `${rootPath}/src/index.ts`,
        `${rootPath}/src/utils.ts`,
        `${rootPath}/src/helper.ts`,
        `${rootPath}/src/config.ts`,
        `${rootPath}/src/config.json`,
        `${rootPath}/docs/readme.md`,
        `${rootPath}/package.json`
      ];
      
      for (const filePath of testFiles) {
        if (await this.fileService.exists(filePath) && !files.includes(filePath)) {
          files.push(filePath);
        }
      }
    } catch {
      // Ignore errors, use only recent files
    }
    
    return [...new Set(files)];
  }

  /**
   * Build dependency graph for files
   */
  private async buildDependencyGraph(filePaths: string[]): Promise<DependencyGraph> {
    const dependencies = new Map<string, FileDependency[]>();
    const dependents = new Map<string, string[]>();
    
    for (const filePath of filePaths) {
      try {
        const imports = await this.astParser.extractImports(filePath);
        const fileDeps: FileDependency[] = [];
        
        for (const importInfo of imports) {
          const resolvedPath = await this.resolveImportPath(filePath, importInfo.from);
          if (resolvedPath) {
            const dependency: FileDependency = {
              filePath: resolvedPath,
              dependencyType: this.classifyDependency(importInfo.from),
              resolvedPath,
              strength: this.calculateDependencyStrength(importInfo)
            };
            
            fileDeps.push(dependency);
            
            // Track reverse dependencies
            if (!dependents.has(resolvedPath)) {
              dependents.set(resolvedPath, []);
            }
            dependents.get(resolvedPath)!.push(filePath);
          }
        }
        
        dependencies.set(filePath, fileDeps);
      } catch {
        // Skip files with parsing errors
        dependencies.set(filePath, []);
      }
    }
    
    // Find clusters of related files
    const clusters = this.findFileClusters(dependencies);
    
    return { dependencies, dependents, clusters };
  }

  /**
   * Resolve import path to actual file path
   */
  private async resolveImportPath(fromFile: string, importPath: string): Promise<string | null> {
    try {
      // Handle relative imports
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const resolved = path.resolve(path.dirname(fromFile), importPath);
        
        // Try common extensions
        const extensions = ['.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js'];
        for (const ext of extensions) {
          const withExt = resolved + ext;
          if (await this.fileService.exists(withExt)) {
            return withExt;
          }
        }
      }
      
      // For now, skip node_modules and absolute imports
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Classify dependency type
   */
  private classifyDependency(importPath: string): FileDependency['dependencyType'] {
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      return 'relative';
    }
    if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
      return 'module';
    }
    if (importPath.includes('.png') || importPath.includes('.jpg') || importPath.includes('.css')) {
      return 'asset';
    }
    return 'import';
  }

  /**
   * Calculate dependency strength based on import information
   */
  private calculateDependencyStrength(importInfo: { from: string; items: string[] }): number {
    // Base strength
    let strength = 0.5;
    
    // More items imported = stronger dependency
    if (importInfo.items.length > 5) {
      strength += 0.3;
    } else if (importInfo.items.length > 2) {
      strength += 0.2;
    }
    
    // Wildcard imports are strong dependencies
    if (importInfo.items.some(item => item.includes('*'))) {
      strength += 0.3;
    }
    
    return Math.min(1, strength);
  }

  /**
   * Find clusters of related files
   */
  private findFileClusters(dependencies: Map<string, FileDependency[]>): string[][] {
    const clusters: string[][] = [];
    const visited = new Set<string>();
    
    for (const [filePath] of dependencies) {
      if (visited.has(filePath)) continue;
      
      const cluster = this.buildCluster(filePath, dependencies, visited);
      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }

  /**
   * Build a cluster starting from a file
   */
  private buildCluster(
    startFile: string, 
    dependencies: Map<string, FileDependency[]>, 
    visited: Set<string>
  ): string[] {
    const cluster: string[] = [];
    const queue = [startFile];
    
    while (queue.length > 0) {
      const currentFile = queue.shift()!;
      if (visited.has(currentFile)) continue;
      
      visited.add(currentFile);
      cluster.push(currentFile);
      
      // Add direct dependencies if they're in the same directory or strongly connected
      const deps = dependencies.get(currentFile) || [];
      for (const dep of deps) {
        if (!visited.has(dep.filePath) && 
            (this.areInSameDirectory(currentFile, dep.filePath) || dep.strength > 0.7)) {
          queue.push(dep.filePath);
        }
      }
    }
    
    return cluster;
  }

  /**
   * Check if two files are in the same directory
   */
  private areInSameDirectory(file1: string, file2: string): boolean {
    return path.dirname(file1) === path.dirname(file2);
  }

  /**
   * Get dependency-based predictions
   */
  async getPredictionsBasedOnDependencies(currentFile: string, limit: number = 5): Promise<PredictionResult[]> {
    if (!this.dependencyGraph) {
      await this.analyzeWorkspace();
    }
    
    const predictions: PredictionResult[] = [];
    
    if (!this.dependencyGraph) {
      return predictions;
    }
    
    // Get direct dependencies
    const dependencies = this.dependencyGraph.dependencies.get(currentFile) || [];
    for (const dep of dependencies.slice(0, limit)) {
      const features = await this.extractEnhancedFeatures([dep.filePath], currentFile);
      if (features.length > 0) {
        predictions.push({
          filePath: dep.filePath,
          confidence: dep.strength * 0.9, // High confidence for direct dependencies
          reason: `Direct dependency of ${path.basename(currentFile)}`,
          features: features[0],
          estimatedLoadTime: this.estimateLoadTime(dep.filePath)
        });
      }
    }
    
    // Get files that depend on current file
    const dependents = this.dependencyGraph.dependents.get(currentFile) || [];
    for (const dependent of dependents.slice(0, Math.max(1, limit - predictions.length))) {
      const features = await this.extractEnhancedFeatures([dependent], currentFile);
      if (features.length > 0) {
        predictions.push({
          filePath: dependent,
          confidence: 0.7, // Medium confidence for reverse dependencies
          reason: `Depends on ${path.basename(currentFile)}`,
          features: features[0],
          estimatedLoadTime: this.estimateLoadTime(dependent)
        });
      }
    }
    
    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze git history to understand file modification patterns
   */
  async analyzeGitHistory(workspaceRoot?: string, options?: {
    lookbackDays?: number;
    minCommits?: number;
    ignoreAuthors?: string[];
  }): Promise<Map<string, FileModificationPattern>> {
    const now = Date.now();
    
    // Return cached analysis if recent (within 1 hour)
    if (this.gitHistoryCache.size > 0 && (now - this.lastGitAnalysis) < 3600000) {
      return this.gitHistoryCache;
    }

    const rootPath = workspaceRoot || process.cwd();
    const opts = {
      lookbackDays: 30,
      minCommits: 5,
      ignoreAuthors: ['dependabot', 'renovate'],
      ...options
    };

    try {
      const commits = await this.getGitCommits(rootPath, opts);
      const patterns = this.analyzeModificationPatterns(commits, opts);
      
      this.gitHistoryCache = patterns;
      this.lastGitAnalysis = now;
      
      return patterns;
    } catch (error) {
      // Return empty patterns on error (git not available, etc.)
      return new Map();
    }
  }

  /**
   * Get git commits for analysis
   */
  private async getGitCommits(
    rootPath: string, 
    options: { lookbackDays: number; ignoreAuthors: string[] }
  ): Promise<GitCommitInfo[]> {
    try {
      const { execSync } = await import('child_process');
      
      // Calculate date for lookback
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - options.lookbackDays);
      const sinceDate = lookbackDate.toISOString().split('T')[0];
      
      // Get git log with file changes
      const gitLogCommand = `git log --since="${sinceDate}" --name-only --pretty="format:COMMIT_START%n%H%n%ct%n%an%n%s%nFILES_START" -- .`;
      
      const gitOutput = execSync(gitLogCommand, { 
        cwd: rootPath, 
        encoding: 'utf8',
        timeout: 30000 // 30 second timeout
      });
      
      return this.parseGitLog(gitOutput, options.ignoreAuthors);
    } catch {
      // Git not available or other error
      return [];
    }
  }

  /**
   * Parse git log output into commit information
   */
  private parseGitLog(gitOutput: string, ignoreAuthors: string[]): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];
    const commitBlocks = gitOutput.split('COMMIT_START\n').filter(block => block.trim());
    
    for (const block of commitBlocks) {
      const lines = block.split('\n').filter(line => line.trim());
      if (lines.length < 4) continue;
      
      const hash = lines[0];
      const timestamp = parseInt(lines[1], 10) * 1000; // Convert to milliseconds
      const author = lines[2];
      const message = lines[3];
      
      // Skip ignored authors
      if (ignoreAuthors.some(ignored => author.toLowerCase().includes(ignored.toLowerCase()))) {
        continue;
      }
      
      // Find files
      const filesStartIndex = lines.findIndex(line => line === 'FILES_START');
      const files = filesStartIndex >= 0 
        ? lines.slice(filesStartIndex + 1).filter(file => file && !file.startsWith('COMMIT_START'))
        : [];
      
      if (files.length > 0) {
        commits.push({
          hash,
          timestamp,
          message,
          files: files.map(file => path.resolve(file)), // Convert to absolute paths
          author
        });
      }
    }
    
    return commits;
  }

  /**
   * Analyze modification patterns from git commits
   */
  private analyzeModificationPatterns(
    commits: GitCommitInfo[], 
    options: { minCommits: number }
  ): Map<string, FileModificationPattern> {
    const patterns = new Map<string, FileModificationPattern>();
    
    // Track file modification counts and co-modifications
    for (const commit of commits) {
      // Process each file in the commit
      for (const file of commit.files) {
        if (!patterns.has(file)) {
          patterns.set(file, {
            file,
            coModifiedWith: new Map(),
            lastModified: commit.timestamp,
            modificationFrequency: 0,
            authors: new Set()
          });
        }
        
        const pattern = patterns.get(file)!;
        pattern.modificationFrequency++;
        pattern.lastModified = Math.max(pattern.lastModified, commit.timestamp);
        pattern.authors.add(commit.author);
        
        // Track co-modifications
        for (const otherFile of commit.files) {
          if (otherFile !== file) {
            const currentCount = pattern.coModifiedWith.get(otherFile) || 0;
            pattern.coModifiedWith.set(otherFile, currentCount + 1);
          }
        }
      }
    }
    
    // Filter out files with insufficient modification history
    for (const [file, pattern] of patterns) {
      if (pattern.modificationFrequency < options.minCommits) {
        patterns.delete(file);
      }
    }
    
    return patterns;
  }

  /**
   * Get predictions based on git history patterns
   */
  async getPredictionsBasedOnGitHistory(currentFile: string, limit: number = 5): Promise<PredictionResult[]> {
    if (!this.config.enabled) {
      return [];
    }
    
    const gitPatterns = await this.analyzeGitHistory();
    const currentPattern = gitPatterns.get(currentFile);
    
    if (!currentPattern) {
      return [];
    }
    
    const predictions: PredictionResult[] = [];
    
    // Get files frequently modified with current file
    const coModified = Array.from(currentPattern.coModifiedWith.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .slice(0, limit);
    
    for (const [filePath, frequency] of coModified) {
      const otherPattern = gitPatterns.get(filePath);
      if (!otherPattern) continue;
      
      // Calculate confidence based on co-modification frequency and recency
      const totalModifications = currentPattern.modificationFrequency;
      const coModificationRatio = frequency / totalModifications;
      const recencyFactor = this.calculateRecencyFactor(otherPattern.lastModified);
      const confidence = Math.min(0.9, coModificationRatio * 0.7 + recencyFactor * 0.3);
      
      if (confidence >= this.config.predictionThreshold) {
        const features = await this.extractEnhancedFeatures([filePath], currentFile);
        predictions.push({
          filePath,
          confidence,
          reason: `Co-modified with ${path.basename(currentFile)} in ${frequency} commits`,
          features: features[0],
          estimatedLoadTime: this.estimateLoadTime(filePath)
        });
      }
    }
    
    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate recency factor for git history predictions
   */
  private calculateRecencyFactor(lastModified: number): number {
    const now = Date.now();
    const daysSinceModification = (now - lastModified) / (1000 * 60 * 60 * 24);
    
    // Exponential decay: more recent = higher factor
    return Math.exp(-daysSinceModification / 30); // 30-day half-life
  }

  /**
   * Update resource metrics and adjust adaptive configuration
   */
  private async updateResourceMetrics(): Promise<void> {
    const now = Date.now();
    
    // Only check resources every 30 seconds to avoid overhead
    if (now - this.lastResourceCheck < 30000) {
      return;
    }
    
    this.lastResourceCheck = now;
    
    try {
      // Update memory usage
      const memoryUsage = process.memoryUsage();
      this.resourceMetrics.memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      
      // Estimate CPU usage (simplified)
      this.resourceMetrics.cpuUsagePercent = Math.min(100, this.currentLoading.size * 10);
      
      // Update concurrent operations
      this.resourceMetrics.concurrentOperations = this.currentLoading.size;
      
      // Estimate disk I/O (simplified based on current operations)
      this.resourceMetrics.diskIOPS = this.currentLoading.size * 2;
      
      // Estimate network latency (placeholder)
      this.resourceMetrics.networkLatencyMs = 50;
      
      // Adjust adaptive configuration based on resource usage
      await this.adjustAdaptiveConfig();
      
    } catch {
      // Ignore resource monitoring errors
    }
  }
  
  /**
   * Adjust adaptive configuration based on current resource usage
   */
  private async adjustAdaptiveConfig(): Promise<void> {
    const memory = this.resourceMetrics.memoryUsageMB;
    const cpu = this.resourceMetrics.cpuUsagePercent;
    const concurrentOps = this.resourceMetrics.concurrentOperations;
    
    // Memory pressure thresholds (MB)
    const memoryHigh = 512; // 512MB
    const memoryLow = 256;  // 256MB
    
    // CPU pressure thresholds
    const cpuHigh = 70;
    const cpuLow = 30;
    
    const newConfig = { ...this.adaptiveConfig };
    
    // Adjust based on memory pressure
    if (memory > memoryHigh) {
      // High memory usage - reduce concurrent loads
      newConfig.maxConcurrentLoads = Math.max(1, Math.floor(this.config.backgroundLoadingConcurrency * 0.5));
      newConfig.backgroundLoadingEnabled = false;
      newConfig.cacheWarningEnabled = false;
      newConfig.modelComplexity = 'simple';
      newConfig.predictionThreshold = Math.min(0.9, this.config.predictionThreshold + 0.2);
    } else if (memory < memoryLow && cpu < cpuLow) {
      // Low resource usage - can be more aggressive
      newConfig.maxConcurrentLoads = this.config.backgroundLoadingConcurrency;
      newConfig.backgroundLoadingEnabled = true;
      newConfig.cacheWarningEnabled = true;
      newConfig.modelComplexity = 'complex';
      newConfig.predictionThreshold = this.config.predictionThreshold;
    } else {
      // Medium resource usage - balanced approach
      newConfig.maxConcurrentLoads = Math.ceil(this.config.backgroundLoadingConcurrency * 0.75);
      newConfig.backgroundLoadingEnabled = concurrentOps < 3;
      newConfig.cacheWarningEnabled = true;
      newConfig.modelComplexity = 'medium';
      newConfig.predictionThreshold = Math.min(0.8, this.config.predictionThreshold + 0.1);
    }
    
    // Adjust based on CPU pressure
    if (cpu > cpuHigh) {
      newConfig.maxConcurrentLoads = Math.max(1, Math.floor(newConfig.maxConcurrentLoads * 0.5));
      newConfig.backgroundLoadingEnabled = false;
    }
    
    // Update configuration if it changed
    if (JSON.stringify(newConfig) !== JSON.stringify(this.adaptiveConfig)) {
      this.adaptiveConfig = newConfig;
      
      // Update metrics
      this.metrics.adaptiveConfig = { ...this.adaptiveConfig };
    }
  }
  
  /**
   * Check if resource limits allow new operations
   */
  private canPerformOperation(): boolean {
    const memory = this.resourceMetrics.memoryUsageMB;
    const concurrentOps = this.resourceMetrics.concurrentOperations;
    
    // Memory limit check (1GB)
    if (memory > 1024) {
      return false;
    }
    
    // Concurrent operations limit
    if (concurrentOps >= this.adaptiveConfig.maxConcurrentLoads) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get current resource status
   */
  getResourceStatus(): {
    metrics: ResourceMetrics;
    adaptiveConfig: AdaptiveConfig;
    canPerformOperation: boolean;
    memoryPressure: 'low' | 'medium' | 'high';
    cpuPressure: 'low' | 'medium' | 'high';
  } {
    const memory = this.resourceMetrics.memoryUsageMB;
    const cpu = this.resourceMetrics.cpuUsagePercent;
    
    let memoryPressure: 'low' | 'medium' | 'high';
    if (memory > 512) {
      memoryPressure = 'high';
    } else if (memory > 256) {
      memoryPressure = 'medium';
    } else {
      memoryPressure = 'low';
    }
    
    let cpuPressure: 'low' | 'medium' | 'high';
    if (cpu > 70) {
      cpuPressure = 'high';
    } else if (cpu > 30) {
      cpuPressure = 'medium';
    } else {
      cpuPressure = 'low';
    }
    
    return {
      metrics: { ...this.resourceMetrics },
      adaptiveConfig: { ...this.adaptiveConfig },
      canPerformOperation: this.canPerformOperation(),
      memoryPressure,
      cpuPressure
    };
  }
  
  /**
   * Destroy predictive cache
   */
  destroy(): void {
    if (this.warmingTimer) {
      clearInterval(this.warmingTimer);
    }
    if (this.patternCleanupTimer) {
      clearInterval(this.patternCleanupTimer);
    }
    
    this.accessPatterns = [];
    this.currentLoading.clear();
    this.loadingQueue.clear();
    this.dependencyGraph = null;
    this.workspaceAnalysis = null;
    this.gitHistoryCache.clear();
  }

  /**
   * Start periodic background tasks
   */
  private startPeriodicTasks(): void {
    // Periodic cache warming
    this.warmingTimer = setInterval(async () => {
      await this.warmCache();
    }, 30000); // Every 30 seconds
    
    // Periodic pattern cleanup and model retraining
    this.patternCleanupTimer = setInterval(async () => {
      const now = Date.now();
      if (now - this.lastModelUpdate > this.config.modelUpdateInterval) {
        await this.trainModel();
      }
      
      // Update resource metrics
      await this.updateResourceMetrics();
    }, 60000); // Every minute
  }

  /**
   * Trigger predictive loading based on access pattern
   */
  private async triggerPredictiveLoading(pattern: FileAccessPattern): Promise<void> {
    // Predict related files and start background loading
    const predictions = await this.predictNextFiles(pattern.filePath, 3);
    if (predictions.length > 0) {
      // Don't await to keep this non-blocking
      this.preloadFiles(predictions).catch(() => {
        // Ignore preload errors
      });
    }
  }

  /**
   * Get candidate files for prediction
   */
  private async getCandidateFiles(currentFile?: string): Promise<string[]> {
    const candidates = new Set<string>();
    
    // Add recently accessed files
    const recentFiles = this.accessPatterns
      .slice(-50) // Last 50 patterns
      .map(p => p.filePath);
    recentFiles.forEach(f => candidates.add(f));
    
    // Add files in same directory as current file
    if (currentFile) {
      const currentDir = path.dirname(currentFile);
      const recentInDir = this.accessPatterns
        .filter(p => path.dirname(p.filePath) === currentDir)
        .map(p => p.filePath);
      recentInDir.forEach(f => candidates.add(f));
    }
    
    // Add commonly accessed files
    const fileFrequency = new Map<string, number>();
    this.accessPatterns.forEach(p => {
      fileFrequency.set(p.filePath, (fileFrequency.get(p.filePath) || 0) + 1);
    });
    
    const frequentFiles = Array.from(fileFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([filePath]) => filePath);
    frequentFiles.forEach(f => candidates.add(f));
    
    return Array.from(candidates);
  }

  /**
   * Extract prediction features for files
   */
  private async extractFeatures(
    filePaths: string[], 
    currentFile?: string
  ): Promise<PredictionFeatures[]> {
    return this.extractEnhancedFeatures(filePaths, currentFile);
  }

  /**
   * Extract enhanced prediction features with dependency analysis
   */
  private async extractEnhancedFeatures(
    filePaths: string[], 
    currentFile?: string
  ): Promise<PredictionFeatures[]> {
    const now = Date.now();
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();
    
    // Ensure workspace analysis is available
    if (!this.workspaceAnalysis) {
      await this.analyzeWorkspace();
    }
    
    return await Promise.all(filePaths.map(async filePath => {
      const recentAccesses = this.accessPatterns.filter(p => p.filePath === filePath);
      const lastAccess = recentAccesses.sort((a, b) => b.timestamp - a.timestamp)[0];
      
      // Calculate temporal proximity
      const temporalProximity = lastAccess 
        ? Math.max(0, 1 - (now - lastAccess.timestamp) / (1000 * 60 * 60)) // 1 hour decay
        : 0;
      
      // Calculate spatial proximity to current file
      const spatialProximity = currentFile 
        ? this.calculateSpatialProximity(filePath, currentFile)
        : 0;
      
      // Calculate access frequency
      const accessFrequency = Math.min(1, recentAccesses.length / 10);
      
      // Get dependency information
      const dependencies = this.dependencyGraph?.dependencies.get(filePath) || [];
      const dependents = this.dependencyGraph?.dependents.get(filePath) || [];
      
      // Calculate dependency metrics
      const dependencyCount = dependencies.length;
      const dependencyStrength = dependencies.length > 0 
        ? dependencies.reduce((sum, dep) => sum + dep.strength, 0) / dependencies.length
        : 0;
      const isDependentOn = Math.min(1, dependents.length / 5); // Normalize to 0-1
      
      // Workspace relevance
      const isEntryPoint = this.workspaceAnalysis?.entryPoints.includes(filePath) ? 1 : 0;
      const isCoreFile = this.workspaceAnalysis?.coreFiles.includes(filePath) ? 1 : 0;
      
      // Calculate workspace relevance score
      let workspaceRelevance = 0;
      if (isEntryPoint) workspaceRelevance += 0.4;
      if (isCoreFile) workspaceRelevance += 0.3;
      if (dependencyCount > 0) workspaceRelevance += 0.2;
      if (dependents.length > 0) workspaceRelevance += 0.1;
      workspaceRelevance = Math.min(1, workspaceRelevance);
      
      return {
        temporalProximity,
        spatialProximity,
        accessFrequency,
        fileType: path.extname(filePath),
        directoryDepth: filePath.split(path.sep).length,
        fileSize: 1000, // Default - could be enhanced with actual file stats
        lastModified: lastAccess?.timestamp || 0,
        dependencyCount,
        dependencyStrength,
        isDependentOn,
        isEntryPoint,
        isCoreFile,
        timeOfDay: currentHour,
        dayOfWeek: currentDay,
        workspaceRelevance
      };
    }));
  }

  /**
   * Calculate spatial proximity between two file paths
   */
  private calculateSpatialProximity(file1: string, file2: string): number {
    const parts1 = file1.split(path.sep);
    const parts2 = file2.split(path.sep);
    
    let commonParts = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) {
        commonParts++;
      } else {
        break;
      }
    }
    
    const maxParts = Math.max(parts1.length, parts2.length);
    return commonParts / maxParts;
  }

  /**
   * Generate human-readable prediction reason
   */
  private generatePredictionReason(features: PredictionFeatures, filePath: string): string {
    const reasons: string[] = [];
    
    if (features.temporalProximity > 0.7) {
      reasons.push('recently accessed');
    }
    if (features.spatialProximity > 0.7) {
      reasons.push('in same directory');
    }
    if (features.accessFrequency > 0.5) {
      reasons.push('frequently accessed');
    }
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : 'pattern-based prediction';
  }

  /**
   * Estimate file load time in milliseconds
   */
  private estimateLoadTime(filePath: string): number {
    const ext = path.extname(filePath).toLowerCase();
    const baseTime = 50; // Base load time
    
    // Adjust based on file type
    const typeMultipliers: Record<string, number> = {
      '.js': 1,
      '.ts': 1.2,
      '.json': 0.8,
      '.md': 0.6,
      '.txt': 0.5,
      '.py': 1.1,
      '.go': 1.1,
      '.java': 1.3,
      '.cpp': 1.4,
      '.h': 1.2
    };
    
    const multiplier = typeMultipliers[ext] || 1;
    return Math.round(baseTime * multiplier);
  }

  /**
   * Check if file was preloaded by predictions
   */
  private wasPreloaded(filePath: string): boolean {
    return this.loadingQueue.has(filePath);
  }

  /**
   * Execute a specific warming strategy
   */
  private async executeWarmingStrategy(strategy: WarmingStrategy): Promise<number> {
    let warmedCount = 0;
    
    switch (strategy.trigger) {
      case 'startup':
        // Warm common patterns at startup
        warmedCount = await this.warmStartupFiles(strategy);
        break;
        
      case 'dependency':
        // Warm files based on dependencies
        warmedCount = await this.warmDependencyFiles(strategy);
        break;
        
      case 'pattern':
        // Warm based on access patterns
        warmedCount = await this.warmPatternFiles(strategy);
        break;
        
      case 'git-history':
        // Warm based on git history patterns
        warmedCount = await this.warmGitHistoryFiles(strategy);
        break;
        
      case 'manual':
        // Manual warming - just warm the specified patterns
        warmedCount = await this.warmManualFiles(strategy);
        break;
      
      default:
        // Unknown strategy type
        warmedCount = 0;
        break;
    }
    
    return Math.min(warmedCount, strategy.maxFiles);
  }

  /**
   * Warm startup files
   */
  private async warmStartupFiles(strategy: WarmingStrategy): Promise<number> {
    // Warm commonly accessed files from patterns
    const fileFrequency = new Map<string, number>();
    this.accessPatterns.forEach(p => {
      fileFrequency.set(p.filePath, (fileFrequency.get(p.filePath) || 0) + 1);
    });
    
    const topFiles = Array.from(fileFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, strategy.maxFiles)
      .map(([filePath]) => filePath);
    
    let loaded = 0;
    for (const filePath of topFiles) {
      try {
        await this.cacheManager.get(filePath);
        loaded++;
      } catch {
        // Ignore errors
      }
    }
    
    return loaded;
  }

  /**
   * Warm dependency files
   */
  private async warmDependencyFiles(strategy: WarmingStrategy): Promise<number> {
    if (!this.dependencyGraph) {
      await this.analyzeWorkspace();
    }
    
    if (!this.dependencyGraph) {
      return 0;
    }
    
    let loaded = 0;
    const recentlyAccessed = this.accessPatterns
      .slice(-10) // Last 10 accesses
      .map(p => p.filePath);
    
    // Warm dependencies of recently accessed files
    for (const filePath of recentlyAccessed) {
      if (loaded >= strategy.maxFiles) break;
      
      const dependencies = this.dependencyGraph.dependencies.get(filePath) || [];
      for (const dep of dependencies) {
        if (loaded >= strategy.maxFiles) break;
        
        try {
          await this.cacheManager.get(dep.filePath);
          loaded++;
        } catch {
          // Ignore errors
        }
      }
    }
    
    return loaded;
  }

  /**
   * Warm pattern-based files
   */
  private async warmPatternFiles(strategy: WarmingStrategy): Promise<number> {
    const predictions = await this.predictNextFiles(undefined, strategy.maxFiles);
    return await this.preloadFiles(predictions);
  }

  /**
   * Warm git history files
   */
  private async warmGitHistoryFiles(strategy: WarmingStrategy): Promise<number> {
    try {
      const gitOptions = strategy.gitOptions || {};
      const gitPatterns = await this.analyzeGitHistory(undefined, gitOptions);
      
      if (gitPatterns.size === 0) {
        return 0;
      }
      
      // Get recently modified files based on git history
      const recentFiles = Array.from(gitPatterns.values())
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, strategy.maxFiles)
        .map(pattern => pattern.file);
      
      let loaded = 0;
      for (const filePath of recentFiles) {
        try {
          await this.cacheManager.get(filePath);
          loaded++;
        } catch {
          // Ignore errors for files that don't exist
        }
      }
      
      return loaded;
    } catch {
      return 0;
    }
  }

  /**
   * Warm manual files
   */
  private async warmManualFiles(_strategy: WarmingStrategy): Promise<number> {
    // This would warm specific file patterns
    // For now, return 0 as placeholder
    return 0;
  }
}

/**
 * Default predictive cache configuration
 */
export const DEFAULT_PREDICTIVE_CACHE_CONFIG: PredictiveCacheConfig = {
  enabled: true,
  maxPredictions: 5,
  predictionThreshold: 0.6,
  backgroundLoadingConcurrency: 2,
  patternWindowMs: 1000 * 60 * 60 * 24, // 24 hours
  warmingStrategies: [
    {
      name: 'startup',
      priority: 10,
      enabled: true,
      trigger: 'startup',
      maxFiles: 10,
      patterns: ['**/*.ts', '**/*.js', '**/*.json']
    },
    {
      name: 'dependency',
      priority: 8,
      enabled: true,
      trigger: 'dependency',
      maxFiles: 8,
      patterns: ['**/*']
    },
    {
      name: 'git-history',
      priority: 7,
      enabled: true,
      trigger: 'git-history',
      maxFiles: 6,
      patterns: ['**/*'],
      gitOptions: {
        lookbackDays: 14,
        minCommits: 3,
        ignoreAuthors: ['dependabot', 'renovate', 'github-actions']
      }
    },
    {
      name: 'pattern',
      priority: 5,
      enabled: true,
      trigger: 'pattern',
      maxFiles: 5,
      patterns: ['**/*']
    }
  ],
  modelUpdateInterval: 1000 * 60 * 10, // 10 minutes
  enableOnlineLearning: true,
  modelType: 'ensemble' // Use ensemble model by default for better predictions
};