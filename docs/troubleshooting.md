# Troubleshooting Guide

This guide provides solutions to common issues and debugging tips.

## Frequently Asked Questions (FAQs)

- **Q: How do I update the CLI to the latest version?**

  - A: If installed globally via npm, you can usually update with `npm install -g <package-name>@latest`. If run from source, pull the latest changes from the repository and rebuild using `npm run build`.

- **Q: Where are the CLI configuration files stored?**

  - A: The CLI configuration is typically managed within `packages/cli/src/config/`. Refer to [CLI Configuration](./cli/configuration.md) for more details.

- **Q: Where are the core configuration files stored?**
  - A: The core configuration is typically managed within `packages/core/src/config/`. Refer to [Core Configuration](./core/configuration.md) for more details.

## FileOperations Tool Troubleshooting

The FileOperations tool provides comprehensive error handling and diagnostics. Here are common issues and their solutions:

### Performance Issues

#### Operation Timeouts

**Symptoms**: Operations fail with timeout errors, especially on large codebases.

**Causes**:
- Large number of files being processed
- Complex AST parsing operations
- Insufficient system resources

**Solutions**:

1. **Increase timeout for specific operations**:
   ```json
   {
     "options": { "timeout": 120000 }, // 2 minutes
     "operations": [/* large operations */]
   }
   ```

2. **Reduce batch size**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "options": { "maxFiles": 50 } // Process in smaller batches
       }
     ]
   }
   ```

3. **Disable expensive features**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "options": {
           "includeContent": false, // Skip content for large scans
           "complexity": false, // Skip complexity analysis
           "dependencies": { "resolve": false }
         }
       }
     ]
   }
   ```

#### Memory Pressure

**Symptoms**: Operations fail with out-of-memory errors or system becomes unresponsive.

**Solutions**:

1. **Reduce concurrency**:
   ```json
   {
     "options": {
       "concurrency": 2, // Reduce from default 4
       "cache": { "maxSize": "50MB" } // Limit cache size
     }
   }
   ```

2. **Disable predictive caching**:
   ```json
   {
     "options": {
       "cache": {
         "predictive": false,
         "enabled": true // Keep basic caching
       }
     }
   }
   ```

3. **Process files in smaller batches**:
   ```json
   {
     "operations": [
       {
         "type": "edit",
         "batch": {
           "files": ["src/components/*.tsx"],
           "batchSize": 10 // Process 10 files at a time
         }
       }
     ]
   }
   ```

### Security and Permission Issues

#### Path Validation Errors

**Symptoms**: Operations fail with "Path not allowed" or "Invalid path" errors.

**Solutions**:

1. **Check allowed paths configuration**:
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

2. **Use relative paths from project root**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["./src/components/*.tsx"] // Use ./ prefix
       }
     ]
   }
   ```

#### Sandbox Execution Failures

**Symptoms**: Custom validators fail to execute or return errors.

**Solutions**:

1. **Disable sandboxing for development**:
   ```json
   {
     "options": {
       "security": { "sandbox": false }
     }
   }
   ```

2. **Increase sandbox limits**:
   ```json
   {
     "options": {
       "security": {
         "sandbox": true,
         "limits": {
           "memory": "100MB",
           "timeout": 30000
         }
       }
     }
   }
   ```

### Operation-Specific Issues

#### AST Parsing Failures

**Symptoms**: Analysis operations fail with syntax errors or parsing failures.

**Solutions**:

1. **Check file syntax**:
   ```json
   {
     "operations": [
       {
         "type": "validate",
         "files": ["problematic-file.ts"],
         "options": { "syntax": true }
       }
     ]
   }
   ```

2. **Use fallback parsing**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "options": {
           "ast": { "fallback": "regex" } // Use regex if AST fails
         }
       }
     ]
   }
   ```

#### Transaction Rollback Issues

**Symptoms**: Operations partially complete but fail to rollback on errors.

**Solutions**:

1. **Check transaction boundaries**:
   ```json
   {
     "operations": [
       {
         "type": "create",
         "path": "file1.ts",
         "transaction": "atomic-op" // Same transaction ID
       },
       {
         "type": "edit",
         "path": "file2.ts",
         "transaction": "atomic-op" // Same transaction ID
       }
     ]
   }
   ```

2. **Enable transaction logging**:
   ```json
   {
     "options": {
       "debug": true,
       "monitoring": {
         "enabled": true,
         "transactions": true
       }
     }
   }
   ```

#### Dependency Resolution Failures

**Symptoms**: Operations fail to resolve file dependencies or imports.

**Solutions**:

1. **Configure module resolution**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "options": {
           "dependencies": {
             "resolve": true,
             "baseUrl": "./src",
             "paths": {
               "@/*": ["./src/*"]
             }
           }
         }
       }
     ]
   }
   ```

2. **Use simplified dependency analysis**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "options": {
           "dependencies": {
             "resolve": false, // Skip resolution
             "includeNodeModules": false
           }
         }
       }
     ]
   }
   ```

### Migration Issues

#### Legacy Tool Compatibility

**Symptoms**: Existing workflows break when transitioning to FileOperations.

**Solutions**:

1. **Use adapter configuration**:
   ```json
   {
     "fileOperations": {
       "enabled": "adapters", // Use legacy adapters
       "tools": {
         "readFile": { "useAdapter": true },
         "writeFile": { "useAdapter": true }
       }
     }
   }
   ```

2. **Gradual migration approach**:
   ```json
   {
     "fileOperations": {
       "enabled": "full",
       "migration": {
         "percentage": 50, // 50% of operations use FileOperations
         "excludeUsers": ["legacy-user-id"]
       }
     }
   }
   ```

#### API Compatibility Issues

**Symptoms**: Tool calls fail due to parameter mismatches.

**Solutions**:

1. **Check parameter mappings**:
   ```typescript
   // Old API
   readFile({ path: "src/utils.ts" })
   
   // New API
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/utils.ts"],
         "options": { "includeContent": true }
       }
     ]
   }
   ```

2. **Use compatibility mode**:
   ```json
   {
     "options": {
       "compatibility": {
         "legacyParams": true,
         "autoConvert": true
       }
     }
   }
   ```

### Debugging and Diagnostics

#### Enable Debug Mode

For detailed troubleshooting information:

```json
{
  "options": {
    "debug": true,
    "monitoring": {
      "enabled": true,
      "metrics": ["timing", "memory", "cache", "errors"]
    }
  }
}
```

#### Check Operation Status

Monitor operation progress and identify bottlenecks:

```json
{
  "options": {
    "streaming": true, // Enable progress updates
    "monitoring": {
      "progress": true,
      "stages": true
    }
  }
}
```

#### Resource Monitoring

Track resource usage to identify performance issues:

```json
{
  "options": {
    "monitoring": {
      "resources": {
        "memory": true,
        "cpu": true,
        "io": true
      }
    }
  }
}
```

### Common Patterns and Best Practices

#### Efficient Operation Design

1. **Group related operations**:
   ```json
   {
     "operations": [
       {
         "type": "analyze",
         "files": ["src/**/*.ts"],
         "id": "analysis"
       },
       {
         "type": "edit",
         "dependencies": ["analysis"],
         "batch": { /* edits based on analysis */ }
       }
     ]
   }
   ```

2. **Use dry run for validation**:
   ```json
   {
     "operations": [
       {
         "type": "edit",
         "dryRun": true, // Preview changes first
         "batch": { /* large batch edits */ }
       }
     ]
   }
   ```

3. **Implement error recovery**:
   ```json
   {
     "operations": [
       {
         "type": "edit",
         "transaction": "safe-edit",
         "onError": "rollback" // Automatic rollback on failure
       }
     ]
   }
   ```

## Common Error Messages and Solutions

- **Error: `EADDRINUSE` (Address already in use) when starting the server.**

  - **Cause:** Another process is already using the port the server is trying to bind to.
  - **Solution:**
    1.  Stop the other process using the port.
    2.  Configure the server to use a different port (see [`core/configuration.md`](./core/configuration.md)).

- **Error: Command not found (when using the CLI).**

  - **Cause:** The CLI is not correctly installed or not in your system's PATH.
  - **Solution:**
    1.  Ensure the CLI installation was successful.
    2.  If installed globally, check that your npm global binary directory is in your PATH.
    3.  If running from source, ensure you are using the correct command to invoke it (e.g., `node packages/cli/dist/index.js ...`).

- **Error: `MODULE_NOT_FOUND` or import errors.**

  - **Cause:** Dependencies are not installed correctly, or the project hasn't been built.
  - **Solution:**
    1.  Run `npm install` to ensure all dependencies are present.
    2.  Run `npm run build` to compile the project.

- **Error: "Operation not permitted" or "Permission denied" or similar.**
  - **Cause:** If sandboxing is enabled, then the application is likely attempting an operation restricted by your sandbox, such as writing outside the project directory or system temp directory.
  - **Solution:** See [README](../README.md#sandboxing) for more information on sandboxing, including how to customize your sandbox configuration.

## Debugging Tips

- **CLI Debugging:**

  - Use the `--verbose` flag (if available) with CLI commands for more detailed output.
  - Check the CLI logs, often found in a user-specific configuration or cache directory.

- **Core Debugging:**

  - Check the server console output for error messages or stack traces.
  - Increase log verbosity if configurable.
  - Use Node.js debugging tools (e.g., `node --inspect`) if you need to step through server-side code.

- **Tool Issues:**

  - If a specific tool is failing, try to isolate the issue by running the simplest possible version of the command or operation the tool performs.
  - For `run_shell_command`, ensure the command works directly in your shell first.
  - For file system tools, double-check paths and permissions.

- **Pre-flight Checks:**
  - Always run `npm run preflight` before committing code. This can catch many common issues related to formatting, linting, and type errors.

If you encounter an issue not covered here, consider searching the project's issue tracker on GitHub or reporting a new issue with detailed information.
