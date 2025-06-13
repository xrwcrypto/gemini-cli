# Tutorials

Master usage of Gemini CLI to automate development tasks.

## FileOperations Tool Tutorials

The FileOperations tool provides powerful capabilities for file manipulation, analysis, and project management. These tutorials will help you master its advanced features.

### Tutorial 1: Code Analysis and Refactoring

Learn how to analyze code structure and perform intelligent refactoring across multiple files.

#### Step 1: Analyze Project Structure

Start by getting an overview of your project's structure and identify potential issues:

```
Analyze all TypeScript files in my src directory. I want to understand the project structure, find all exported functions, and identify any potential code quality issues.
```

**Behind the scenes**, Gemini will use FileOperations like this:

```json
{
  "operations": [
    {
      "type": "analyze",
      "files": ["src/**/*.ts", "src/**/*.tsx"],
      "options": {
        "includeContent": true,
        "includeSymbols": true,
        "symbols": {
          "functions": true,
          "classes": true,
          "interfaces": true,
          "exports": true,
          "imports": true
        },
        "dependencies": {
          "resolve": true,
          "includeNodeModules": false
        },
        "complexity": {
          "cyclomatic": true,
          "cognitive": true
        }
      }
    }
  ]
}
```

#### Step 2: Identify Refactoring Opportunities

Look for code patterns that can be improved:

```
Search for all console.log statements and TODO comments across the codebase. Also find any functions with high complexity that might need refactoring.
```

**FileOperations usage**:

```json
{
  "operations": [
    {
      "type": "analyze",
      "files": ["src/**/*.{ts,tsx,js,jsx}"],
      "options": {
        "searchPatterns": [
          {
            "pattern": "console\\.(log|warn|error|debug)",
            "type": "regex",
            "caseSensitive": false
          },
          {
            "pattern": "TODO|FIXME|HACK",
            "type": "regex",
            "caseSensitive": false
          }
        ],
        "complexity": {
          "cyclomatic": true,
          "threshold": 10
        }
      }
    }
  ]
}
```

#### Step 3: Perform Batch Refactoring

Remove debug statements and update import patterns across multiple files:

```
Remove all console.log statements from my source files and update any old import patterns from './utils' to './utils/index'. Apply these changes atomically so I can rollback if needed.
```

**FileOperations usage**:

```json
{
  "operations": [
    {
      "type": "edit",
      "batch": {
        "files": ["src/**/*.{ts,tsx}"],
        "edits": [
          {
            "type": "findReplace",
            "find": "console\\.log\\([^)]*\\);?",
            "replace": "// Debug statement removed",
            "options": { "regex": true, "replaceAll": true }
          }
        ]
      },
      "transaction": "refactor-cleanup"
    },
    {
      "type": "edit",
      "batch": {
        "files": ["src/**/*.{ts,tsx}"],
        "edits": [
          {
            "type": "findReplace",
            "find": "from ['\"]\\./utils['\"]",
            "replace": "from './utils/index'",
            "options": { "regex": true, "replaceAll": true }
          }
        ]
      },
      "transaction": "refactor-cleanup"
    }
  ]
}
```

### Tutorial 2: Feature Development Workflow

Learn how to efficiently implement new features using FileOperations for file creation, modification, and testing.

#### Step 1: Create Feature Structure

Set up the basic structure for a new authentication feature:

```
Create a new authentication feature structure in src/features/auth/. I need index.ts, types.ts, hooks.ts, and components/ directory with AuthForm.tsx. Set up the basic exports and TypeScript interfaces.
```

**FileOperations usage**:

```json
{
  "operations": [
    {
      "type": "create",
      "path": "src/features/auth",
      "directory": true,
      "transaction": "auth-feature"
    },
    {
      "type": "create",
      "path": "src/features/auth/index.ts",
      "content": "export * from './types';\nexport * from './hooks';\nexport * from './components';",
      "transaction": "auth-feature"
    },
    {
      "type": "create",
      "path": "src/features/auth/types.ts",
      "content": "export interface User {\n  id: string;\n  email: string;\n  name: string;\n}\n\nexport interface AuthState {\n  user: User | null;\n  isLoading: boolean;\n  error: string | null;\n}",
      "transaction": "auth-feature"
    },
    {
      "type": "create",
      "path": "src/features/auth/components",
      "directory": true,
      "transaction": "auth-feature"
    },
    {
      "type": "create",
      "path": "src/features/auth/components/AuthForm.tsx",
      "template": "react-component",
      "variables": {
        "componentName": "AuthForm",
        "hasProps": true
      },
      "transaction": "auth-feature"
    }
  ]
}
```

#### Step 2: Implement Business Logic

Add the authentication hooks and connect them to the components:

```
Implement useAuth hook with login, logout, and state management. Update AuthForm to use this hook and add proper TypeScript types.
```

#### Step 3: Integration and Testing

Update the main app to integrate the new feature and add tests:

```
Update src/App.tsx to include the new AuthForm component. Also create test files for the auth feature components and hooks.
```

### Tutorial 3: Code Quality and Maintenance

Learn how to use FileOperations for code quality improvements, linting, and maintenance tasks.

#### Step 1: Comprehensive Code Validation

Run comprehensive validation across your entire codebase:

```
Run a full code quality check on my TypeScript project. Check syntax, imports, run ESLint, and identify any type errors. Auto-fix what can be safely fixed.
```

**FileOperations usage**:

```json
{
  "operations": [
    {
      "type": "validate",
      "files": ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
      "options": {
        "syntax": true,
        "imports": true,
        "lint": {
          "rules": ["no-console", "no-debugger", "consistent-naming"],
          "autoFix": true
        },
        "external": {
          "typescript": {
            "enabled": true,
            "configFile": "tsconfig.json"
          },
          "eslint": {
            "enabled": true,
            "configFile": ".eslintrc.json"
          }
        }
      }
    }
  ]
}
```

#### Step 2: Dependency Analysis and Cleanup

Identify unused imports and circular dependencies:

```
Analyze all import/export relationships in my project. Find unused imports, circular dependencies, and identify files that might be missing exports.
```

#### Step 3: Performance Optimization

Identify performance bottlenecks and optimization opportunities:

```
Analyze my React components for performance issues. Look for components that might benefit from memoization, identify heavy re-renders, and suggest optimization strategies.
```

### Tutorial 4: Project Migration and Transformation

Learn how to use FileOperations for large-scale code transformations and migrations.

#### Step 1: Library Migration

Migrate from an old library to a new one across multiple files:

```
I need to migrate from lodash to native JavaScript methods across my entire codebase. Replace _.map with native map, _.filter with native filter, etc. Show me what will change before applying.
```

**FileOperations usage**:

```json
{
  "operations": [
    {
      "type": "edit",
      "batch": {
        "files": ["src/**/*.{ts,tsx,js,jsx}"],
        "dryRun": true,
        "edits": [
          {
            "type": "findReplace",
            "find": "_\\.map\\(",
            "replace": "map(",
            "options": { "regex": true, "replaceAll": true }
          },
          {
            "type": "findReplace",
            "find": "_\\.filter\\(",
            "replace": "filter(",
            "options": { "regex": true, "replaceAll": true }
          }
        ]
      }
    }
  ]
}
```

#### Step 2: API Pattern Updates

Update API calling patterns across the application:

```
Update all API calls to use the new async/await pattern instead of .then() chains. Also update error handling to use try/catch blocks.
```

#### Step 3: Component Architecture Migration

Migrate React class components to functional components:

```
Convert React class components to functional components with hooks. Identify all class components first, then convert them one by one with proper state and lifecycle method translations.
```

### Tutorial 5: Advanced Workflow Automation

Learn advanced FileOperations techniques for complex workflows.

#### Step 1: Intelligent File Organization

Automatically organize files based on their content and usage patterns:

```
Analyze my project and suggest a better file organization structure. Move related components together and create proper index files for cleaner imports.
```

#### Step 2: Documentation Generation

Generate documentation based on code analysis:

```
Generate documentation for all my exported functions and components. Create markdown files with API documentation based on JSDoc comments and TypeScript types.
```

#### Step 3: Build Pipeline Integration

Create build-time transformations and optimizations:

```
Before building my project, optimize import statements, remove unused code, and ensure all TypeScript strict mode requirements are met across the codebase.
```

### Performance Optimization Tips

#### Batch Operations Efficiently

When performing multiple related operations, group them for better performance:

```
// Good: Group related operations
{
  "operations": [
    {
      "type": "analyze",
      "files": ["src/**/*.ts"],
      "options": { "includeSymbols": true }
    },
    {
      "type": "edit",
      "batch": {
        "files": ["src/**/*.ts"],
        "edits": [/* multiple edits */]
      }
    }
  ]
}

// Less efficient: Multiple separate calls
// Multiple individual tool calls for each file
```

#### Use Predictive Caching

Enable predictive caching for projects with consistent access patterns:

```json
{
  "options": {
    "cache": {
      "predictive": true,
      "warmup": ["src/index.ts", "package.json"],
      "strategy": "dependency-aware"
    }
  }
}
```

#### Optimize for Large Projects

For large codebases, use filtering and pagination:

```json
{
  "operations": [
    {
      "type": "analyze",
      "files": ["src/**/*.ts"],
      "options": {
        "includeContent": false, // Skip content for large scans
        "includeSymbols": true,
        "maxFiles": 100 // Process in batches
      }
    }
  ]
}
```

### Troubleshooting Common Scenarios

#### Operation Timeouts

For large operations that might timeout:

```json
{
  "options": { "timeout": 120000 }, // 2 minutes
  "operations": [/* large operations */]
}
```

#### Memory Pressure

When working with many large files:

```json
{
  "options": {
    "concurrency": 2, // Reduce parallelism
    "cache": { "maxSize": "50MB" }
  }
}
```

#### Permission Issues

When encountering permission errors:

```json
{
  "options": {
    "security": {
      "allowedPaths": ["src/", "docs/", "tests/"],
      "blockedPaths": [".git/", "node_modules/"]
    }
  }
}
```

These tutorials demonstrate the power and flexibility of the FileOperations tool. By combining multiple operations in intelligent ways, you can accomplish complex development tasks efficiently and reliably.

## Setting up Model Context Protocol (MCP) Servers

> **A Note on Third-Party MCP Servers:** Before using a third-party MCP server, ensure you trust its source and understand the tools it provides. Your use of third-party servers is at your own risk.

### GitHub MCP Server

The [GitHub MCP server] provides tools for interacting with GitHub repositories, such as creating issues, commenting on pull requests, and more.

[GitHub MCP server]: https://github.com/github/github-mcp-server

#### Prerequisites

Before you begin, ensure you have the following installed and configured:

- **Docker:** Install and run [Docker].
- **GitHub Personal Access Token (PAT):** Create a new [classic] or [fine-grained] PAT with the necessary scopes.

[Docker]: https://www.docker.com/
[classic]: https://github.com/settings/tokens/new
[fine-grained]: https://github.com/settings/personal-access-tokens/new

#### Guide

##### Configure the MCP Server in `settings.json`

In your project's root directory, create or open the `.gemini/settings.json` file. Add the `mcpServers` configuration block to instruct Gemini how to launch the GitHub server.

```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

##### Set Your GitHub Token

Use an environment variable to store your PAT.

```bash
GITHUB_PERSONAL_ACCESS_TOKEN="pat_YourActualGitHubTokenHere"
```

Gemini CLI will automatically substitute the `${GITHUB_PERSONAL_ACCESS_TOKEN}` placeholder from your `settings.json` file.

##### Launch Gemini CLI and Verify the Connection

Gemini CLI will automatically read your configuration and launch the GitHub MCP server in the background. You can ask Gemini CLI to perform GitHub actions in natural language.

```bash
"get all open issues assigned to me in the 'foo/bar' repo and prioritize them"
```
