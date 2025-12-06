# Testing Guide

This project uses [Mocha](https://mochajs.org/) as the testing framework with TypeScript support.

## Project Structure

```
src/
├── test/
│   └── unit/           # Unit tests for pure functions
│       └── *.test.ts   # Test files (follow *.test.ts naming convention)
└── utils.ts           # VS Code-dependent utilities
```

## Running Tests

**Unit tests only:**
```bash
yarn test:unit
```

**All tests (unit + integration):**
```bash
yarn test:all
```

**Watch mode (re-run tests when files change):**
```bash
yarn test:unit --watch
```

**Run specific test file:**
```bash
yarn test:unit src/test/unit/specific-file.test.ts
```

## Configuration

- **`.mocharc.json`** - Main Mocha configuration
- **`tsconfig.json`** - TypeScript compilation settings (used by ts-node)

## Writing Tests

### Basic Test Structure
```typescript
import { describe, it } from 'mocha';
import * as assert from 'assert';
import { functionToTest } from '../../pure-utils';

describe('functionToTest', () => {
  it('should do something specific', () => {
    const result = functionToTest('input');
    assert.strictEqual(result, 'expected output');
  });
});
```

### Test Organization
- Use `describe()` to group related tests
- Use `it()` for individual test cases
- Write descriptive test names that explain the expected behavior

### Assertions
- `assert.strictEqual(actual, expected)` - Exact equality
- `assert.ok(value)` - Truthy check
- `assert.strictEqual(result, null)` - Null check

## Pure vs VS Code-Dependent Functions

**VS Code-dependent functions** (require integration tests):
- Functions using `vscode.*` APIs
- Require VS Code Extension Host environment
- More complex test setup needed

## Tips

- Keep test files next to the code they test (in the `test/` directory)
- Write tests for edge cases and error conditions
- Test both success and failure scenarios
- Use descriptive test names that read like documentation