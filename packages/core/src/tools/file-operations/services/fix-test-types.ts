/**
 * Helper to fix type issues in tests
 */

// Replace all occurrences of:
// type: 'analyze', files: [...] 
// with:
// type: 'analyze', paths: [...]

// Replace all occurrences of:
// type: 'validate', files: [...], validators: [...]
// with:
// type: 'validate', files: [...], checks: [...]

// Replace all occurrences of:
// analyses: [{ type: 'pattern', options: { pattern: '...' } }]
// with:
// patterns: ['...']

// For line changes, add operation: 'insert' | 'replace' | 'delete'