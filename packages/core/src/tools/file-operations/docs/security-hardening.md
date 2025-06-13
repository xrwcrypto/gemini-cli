# FileOperations Security Hardening System

## Overview

The FileOperations Security Hardening System provides comprehensive security features to protect against common vulnerabilities and attacks. It includes path traversal prevention, input sanitization, sandboxed code execution, resource limits, and comprehensive audit logging.

## Architecture

### Core Components

1. **SecurityService** - Main security orchestrator
   - Path validation and sanitization
   - Rate limiting and resource management
   - Audit logging and reporting
   - Security event tracking

2. **SandboxService** - Secure code execution environment
   - Isolated worker threads for custom validators
   - Resource limits (CPU, memory, time)
   - Module access control
   - Network isolation

3. **SecureRequestParser** - Enhanced request validation
   - Extends base RequestParser with security checks
   - Input sanitization for all operation types
   - Memory usage estimation
   - Custom validator sandboxing

4. **SecureExecutionEngine** - Security-aware execution
   - Integrates all security components
   - Sandboxed validator execution
   - Security metadata in responses
   - Comprehensive error handling

## Security Features

### 1. Path Traversal Prevention

#### Enhanced Path Validation
- Detects and blocks directory traversal attempts (`../`, `..\\`)
- Prevents access to system directories (`/dev/`, `/proc/`, `/sys/`, `/etc/`)
- Blocks sensitive file access (SSH keys, GPG keys, system files)
- Prevents shell variable expansion and command substitution
- Validates symbolic links don't point outside root directory

#### Directory Controls
- Whitelist/blacklist directory support
- Maximum directory depth limits
- File extension filtering (allowed/blocked)
- Root directory jail enforcement

```typescript
const securityConfig: SecurityConfig = {
  allowedDirectories: ['/workspace/src', '/workspace/test'],
  blockedDirectories: ['/workspace/.git', '/workspace/node_modules'],
  maxDirectoryDepth: 5,
  allowedExtensions: ['.js', '.ts', '.json'],
  blockedExtensions: ['.exe', '.sh', '.bat'],
};
```

### 2. Input Sanitization

#### Sanitization Types
- **Path sanitization**: Removes null bytes and control characters
- **Regex sanitization**: Prevents regex injection while preserving functionality
- **Code sanitization**: Removes script tags, javascript: protocol, event handlers

#### Applied To
- File paths in all operations
- Regex patterns in analyze operations
- Replacement content in edit operations
- File content in create operations
- Custom validator code

### 3. Sandboxed Code Execution

#### Sandbox Features
- Isolated worker threads with resource limits
- Disabled dangerous globals (process, eval, Function)
- Module access control (whitelist safe modules)
- Execution timeout enforcement
- Memory limit enforcement
- CPU time tracking

#### Safe Module Access
```javascript
// In sandbox, only allowed modules can be required
const path = sandbox.require('path'); // Allowed
const fs = sandbox.require('fs'); // Blocked - throws error
```

#### Custom Validator Execution
```javascript
// Validators run in sandbox with strict limits
const validator = function(content, filePath) {
  // No access to file system, network, or dangerous APIs
  // Must return array of ValidationIssue objects
  return [{
    line: 1,
    column: 1,
    message: 'Issue found',
    severity: 'warning'
  }];
};
```

### 4. Resource Usage Limits

#### Rate Limiting
- Operations per minute per user
- Automatic rate limit reset after time window
- Per-user tracking for fairness

#### Memory Limits
- Maximum memory usage per user
- Operation memory estimation
- Memory usage tracking and cleanup

#### Execution Limits
- Maximum concurrent operations
- Sandbox execution timeout
- Worker thread resource limits

```typescript
const securityConfig: SecurityConfig = {
  maxFileSize: 100 * 1024 * 1024, // 100MB
  operationRateLimit: 100, // 100 ops/minute
  maxMemoryUsage: 500 * 1024 * 1024, // 500MB
  maxConcurrentOperations: 10,
  sandboxTimeout: 30000, // 30 seconds
};
```

### 5. Audit Logging

#### Logged Events
- All operation attempts (allowed/denied/error)
- Security violations with reasons
- Resource limit violations
- Rate limit violations
- Suspicious activity patterns

#### Audit Entry Structure
```typescript
interface SecurityAuditEntry {
  timestamp: Date;
  operationId: string;
  operationType: string;
  userId?: string;
  sessionId: string;
  action: string;
  resource: string;
  result: 'allowed' | 'denied' | 'error';
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

#### Security Reports
```typescript
const report = securityService.generateSecurityReport();
// Returns:
// - Summary statistics (total/allowed/denied operations)
// - Top denied reasons
// - Operations by type
// - Suspicious activity (multiple failures)
```

## Usage

### Basic Usage with Security

```typescript
import { SecureFileOperationsTool } from './file-operations-secure.js';

const tool = new SecureFileOperationsTool(config, rootDirectory, {
  enableAuditLogging: true,
  operationRateLimit: 50,
  maxMemoryUsage: 100 * 1024 * 1024,
  blockedDirectories: ['.git', 'node_modules'],
  blockedExtensions: ['.exe', '.sh'],
});

// Execute with user tracking
const result = await tool.execute(request, outputHandler, abortSignal, 'user123');

// Get security report
const report = tool.generateSecurityReport();
console.log(report);
```

### Advanced Configuration

```typescript
const securityConfig: SecurityConfig = {
  // File size limits
  maxFileSize: 50 * 1024 * 1024, // 50MB per file
  
  // Rate limiting
  operationRateLimit: 100, // 100 operations per minute
  
  // Memory limits
  maxMemoryUsage: 200 * 1024 * 1024, // 200MB total
  
  // Concurrency limits
  maxConcurrentOperations: 5,
  
  // Sandbox configuration
  sandboxTimeout: 10000, // 10 seconds
  
  // Directory controls
  allowedDirectories: ['src', 'test', 'docs'],
  blockedDirectories: ['.git', '.svn', 'node_modules'],
  
  // File type controls
  allowedExtensions: ['.js', '.ts', '.json', '.md'],
  blockedExtensions: ['.exe', '.dll', '.so', '.sh'],
  
  // Features
  enableAuditLogging: true,
  resolveSymlinks: true,
  maxDirectoryDepth: 10,
};
```

### Security Event Monitoring

```typescript
const securityService = tool.getSecurityService();

// Listen for security events
securityService.on('security-event', (event: SecurityAuditEntry) => {
  if (event.result === 'denied') {
    console.warn(`Security violation: ${event.reason}`);
    // Send alert, log to external system, etc.
  }
});

// Query audit logs
const deniedOps = securityService.getAuditLog({
  result: 'denied',
  startTime: new Date(Date.now() - 3600000), // Last hour
});

// Check for suspicious activity
const report = securityService.generateSecurityReport();
if (report.suspiciousActivity.length > 0) {
  console.warn('Suspicious activity detected:', report.suspiciousActivity);
}
```

## Security Best Practices

### 1. Configure Appropriate Limits
- Set rate limits based on expected usage patterns
- Configure memory limits to prevent DoS attacks
- Use reasonable timeout values for sandboxed code

### 2. Monitor Security Events
- Regularly review audit logs
- Set up alerts for repeated failures
- Monitor resource usage patterns

### 3. Use Directory Controls
- Whitelist allowed directories when possible
- Always block sensitive directories (.git, .env, etc.)
- Limit directory traversal depth

### 4. Validate Custom Code
- Always run custom validators in sandbox
- Set appropriate execution timeouts
- Monitor validator execution metrics

### 5. Regular Security Reviews
- Review denied operations for attack patterns
- Update blocked patterns based on threats
- Keep security configuration up to date

## Testing Security

### Path Traversal Tests
```typescript
// These should all be blocked
const maliciousPaths = [
  '../../../etc/passwd',
  '/etc/hosts',
  '..\\..\\windows\\system32',
  '/dev/null',
  '/proc/self/environ',
  '${HOME}/.ssh/id_rsa',
  '`cat /etc/passwd`',
];
```

### Injection Tests
```typescript
// These should be sanitized
const injectionAttempts = [
  '<script>alert("xss")</script>',
  'javascript:eval("malicious")',
  'onclick="hack()"',
  'file\0.txt',
];
```

### Resource Exhaustion Tests
```typescript
// These should hit limits
const resourceTests = [
  // Large file creation
  { type: 'create', files: [{ path: 'huge.txt', content: 'x'.repeat(200*1024*1024) }] },
  
  // Infinite loop in validator
  { type: 'validate', validators: [{ type: 'custom', options: { validator: 'while(true){}' } }] },
  
  // Excessive operations
  Array(1000).fill({ type: 'analyze', files: ['test.js'] }),
];
```

## Performance Considerations

1. **Audit Log Size**: Logs are automatically trimmed to prevent unbounded growth
2. **Sandbox Overhead**: Each custom validator incurs ~10-50ms overhead
3. **Path Validation**: Symbolic link resolution may add I/O overhead
4. **Memory Tracking**: Minimal overhead for tracking resource usage

## Integration with Existing Tools

The security layer integrates seamlessly with existing FileOperations components:

1. **Request Parser**: Enhanced with security validation
2. **Execution Engine**: Wrapped with security checks
3. **Validators**: Sandboxed execution for custom validators
4. **Response Builder**: Includes security metadata

## Future Enhancements

1. **Machine Learning**: Anomaly detection for unusual access patterns
2. **Cryptographic Signing**: Sign operation requests for integrity
3. **External Auth Integration**: Connect to enterprise auth systems
4. **Compliance Modes**: GDPR, HIPAA, SOC2 preset configurations
5. **Security Dashboards**: Real-time security monitoring UI