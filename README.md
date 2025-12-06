# Timex - Tools in Markdown (VSCode Extension)

## About Timex

This extension contains several groups of related utilities and tools for Markdown files related to Calendar Management, Document Building/Management, and AI-assisted writing. Each feature set has its own documentation file as follows:

### [Calendar](docs/timex-Calendar.md)

The Calendar features are primarily for allowing a calendar to be implemented in such a way that you have each calendar item stored in its own markdown file, along with a custom View/Panel that lets you manage, search, filter the files as a chronological list, that you can search by time ranges, by tags, by text, etc.

### [Document Building](docs/timex-Builder.md)

The Document Builder feature provides a set of functions allowing you to be able to manage ordered sets of files/folders where the ordering is done by automatic filename prefixing (ordinals), so that files and folders can have precise positions relative to their parent folder. This enables easy authoring of large documents by representing them (documents, research papers, sets of Jupyter Notebooks, etc) as a VSCode project.

### [AI Writing](docs/timex-AI.md)

The AI Writing feature comes in the form of a Custom Chat Participant named (@writer) which is automatically driven to provide a powerful way for the AI to assist you with writing tasks of any kind, which is fully configurable with custom AI Prompt Templates, and helpful features to aid in writing.


## Developer Information

### Prerequisites
- Node.js (v14 or higher)
- npm
- VSCode

### Compilation
```bash
npm install
npm run compile
```

### Development Testing
```bash
# Press F5 in VSCode to launch Extension Development Host
# Or run:
code --extensionDevelopmentPath=. .
```

### Building Distribution Package (VSIX)

```bash
chmod +x install.sh
./install.sh
```

This script will:
1. Install npm dependencies
2. Compile the TypeScript code
3. Package the extension into a `.vsix` file
4. Install it in VS Code

### Testing

This extension uses **Mocha** as the testing framework for unit tests. The testing infrastructure includes comprehensive test coverage for core utility functions like date parsing, timestamp formatting, and relative date calculations.

For detailed information about running tests, test structure, and testing best practices, see **[docs/testing.md](docs/testing.md)**.

Key testing commands:
```bash
# Run all unit tests
npm run test:unit

# Run tests in watch mode during development
npm run test:watch
```

The test suite covers pure utility functions (date/time operations, parsing logic) that don't depend on the VS Code API, making them easily testable in a Node.js environment.

