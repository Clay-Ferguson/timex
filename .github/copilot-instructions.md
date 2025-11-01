# AI Agent Guide: Timex VS Code Extension

Essential knowledge for AI coding agents to be immediately productive in this markdown-based task management extension.

## Core Purpose
Lightweight VS Code extension that transforms markdown files into a chronological task manager. Scans workspace for `.md` files containing configurable hashtags (default `#todo`), extracts timestamps and priorities, displays them in a filterable tree view with due-date proximity indicators.

## Architecture Overview

### Entry Point (`src/extension.ts`)
- **Commands Registration**: 17+ commands from timestamp insertion to ordinal file management
- **File Watcher**: Real-time `.md` file monitoring with 100ms debounce
- **Tree View Setup**: Wires `TaskProvider` to VS Code's tree view API
- **Timestamp Manipulation**: `addTimeToTask()` preserves original format (date-only vs full datetime)

### Data Layer (`src/model.ts`)
- **TaskProvider**: Main data provider implementing `vscode.TreeDataProvider<TaskFileItem>`
- **TaskFile**: Raw parsed data (filePath, timestamp, priority, completion status)  
- **TaskFileItem**: VS Code TreeItem with display formatting and tooltips
- **State Management**: In-memory arrays (`taskFileData`, `taskFiles`) + filter state
- **Performance Strategy**: `updateSingleTask()` for targeted updates vs full `scanForTaskFiles()`

### Configuration (`package.json`)
Three workspace settings:
- `timex.primaryHashtag`: Active hashtag for filtering (default `#todo`)
- `timex.hashtags`: Available hashtags for picker (default `#todo, #todo, #note`) 
- `timex.newTaskFolder`: Target folder for new tasks (supports absolute file system paths)

## Task File Format Rules

### Recognition Logic
```markdown
# Any markdown file containing active primary hashtag is a "task"
# Files starting with `_` or `.` are ignored
# Directories: node_modules, .git, .vscode, out, dist, build, .next, target are skipped

#todo [09/30/2025 02:00:00 PM] #p2  # ← This line makes it a task
Additional content can be anything...
```

### Timestamp Parsing
**Supported formats only:**
- `[MM/DD/YYYY]` → assumes 12:00 PM same day
- `[MM/DD/YYYY HH:MM:SS AM/PM]` → exact time
- **Regex**: `/\[[0-9]{2}\/[0-9]{2}\/20[0-9]{2}(?:\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s(?:AM|PM))?\]/`
- Missing timestamp → sentinel date `01/01/2050 12:00:00 PM` (displays as `(?)`)

### Priority & Status
- **Priority**: `#p1` (red 🔴), `#p2` (orange 🟠), `#p3` (blue 🔵). No tag = `#p1`
- **Completion**: `#done` anywhere in file marks completed (✅ icon)
- **Far Future**: >365 days shows white circle ⚪ (includes sentinel dates)

### Display Label Logic
```typescript
// If file has only hashtags/timestamps, use clean filename as label
if (nonEmptyLines.length === 1 && (line.startsWith('#') || line.startsWith('['))) {
    return fileName.replace(/^[\d_]+/, ''); // Strip "0001_" prefixes
}
// Otherwise use first non-blank line, cleaned of hashtags
```

## Key Workflow Patterns

### File Watching & Updates
```typescript
// Real-time updates via file watcher (extension.ts:setupFileWatcher)
watcher.onDidChange(async (uri) => {
    // 100ms delay for file write completion
    await new Promise(resolve => setTimeout(resolve, 100));
    // Smart update: single task vs full refresh
    await taskProvider.updateSingleTask(filePath, timestampMatch[0]);
});
```

### Filter State Management
- **Filter combinations**: View (All|Due Soon|Overdue) × Priority (all|p1|p2|p3) × Completion (all|completed|not-completed)
- **Search overlay**: Filename + content matching, case-insensitive, preserves other filters
- **State clearing**: Any filter change clears `currentSearchQuery`
- **Title sync**: `updateTreeViewTitle()` reflects all active filters

### Performance Optimization
```typescript
// Prefer targeted updates when possible
updateSingleTask(filePath, newTimestamp) // Updates one task efficiently  
vs
refresh() // Full workspace rescan

// In-memory filtering for search
applyFiltersToExistingData() // Uses cached taskFileData
vs  
scanForTaskFiles() // Filesystem scan + parse
```

## Development Workflow

### Build & Test
```bash
npm install           # Install dependencies
npm run compile       # TypeScript → out/
npm run watch         # Auto-rebuild on changes (background task available)
```

### Debug Setup
- **F5**: Launch Extension Development Host (clean VS Code instance)
- **Test Strategy**: Open external workspace folder with `.md` files (don't create test files in this repo)
- **Extension logs**: Help → Toggle Developer Tools → Console

### Packaging & Distribution
```bash
npm install -g @vscode/vsce
vsce package                    # Creates .vsix file
code --install-extension timex-0.0.2.vsix
```

## Critical Implementation Details

### Timestamp Manipulation (`addTimeToTask`)
Preserves original format when extending dates:
```typescript
// Detects original format and maintains it
const isLongFormat = cleanTimestamp.includes(' ') && cleanTimestamp.includes(':');
// Long: [MM/DD/YYYY HH:MM:SS AM/PM] 
// Short: [MM/DD/YYYY]
```

### Hashtag Switching
Primary hashtag changes trigger:
1. `clearPrimaryHashtagCache()` - Invalidates cached config
2. `refresh()` - Full rescan with new hashtag filter
3. `updateTreeViewTitle()` - UI title update

### Absolute Path Support
```typescript
// Supports both absolute and relative paths
// Absolute: "/home/user/tasks", "/tmp/my-tasks"
// Relative: "tasks" (resolved relative to workspace root)
// Auto-detection using path.isAbsolute()
```

### Sentinel Date Logic
Year 2050+ indicates "no real timestamp":
- Displays as `(?)` in day count
- Always sorts to bottom
- Gets far-future icon treatment
- Used for files without `[MM/DD/YYYY...]` patterns

## Ordinal-Based File Management (NEW)

Recent addition providing file organization capabilities using numeric prefixes.

### Commands Added
- `timex.renumberFiles` - "Re-Number Files" 
- `timex.insertOrdinalFile` - "Insert File"

### Core Logic (`src/utils.ts`)
```typescript
// Key functions for ordinal file management
scanForNumberedItems(workspaceRoot) // Finds files matching /^(\d+)_(.*)$/
verifyNamesAreUnique(numberedItems) // Prevents duplicate names (ignoring ordinals)  
renumberItems(numberedItems)        // Renumbers with 00010, 00020, 00030... pattern
generateNextOrdinalFilename(path)   // Creates next ordinal file (+1 from selected)
extractOrdinalFromFilename(name)    // Parses ordinal number from filename
```

### File Pattern Recognition
- **Regex**: `/^(\d+)_(.*)$/` matches files like `001_task.md`, `0123_project.md`
- **Skips**: Hidden files (starting with `.` or `_`)
- **Operates on**: Both files and folders in workspace root only (non-recursive)

### Re-Number Files Workflow
1. Right-click in file explorer → "Re-Number Files"
2. Scans workspace root for ordinal files/folders
3. **Preserves existing order** (sorts by current numeric prefix, not alphabetically)
4. Validates unique names (after removing ordinal prefixes)
5. Shows confirmation with count of items to rename
6. Renumbers starting at `00010`, incrementing by 10
7. Skips files already correctly numbered

### Insert File Workflow  
1. Right-click on ordinal file (e.g., `00020_requirements.md`)
2. "Insert File" appears in context menu (conditional: `resourceFilename =~ /^\\d+_.+/`)
3. Parses current ordinal (20), increments (+1 = 21)
4. Creates `00021_new.md` in same directory
5. Opens new empty file in editor

### Menu Integration
```json
// package.json - Context menu conditional display
"explorer/context": [
  {
    "command": "timex.renumberFiles",
    "group": "7_modification"
  },
  {
    "command": "timex.insertOrdinalFile", 
    "group": "7_modification",
    "when": "resourceFilename =~ /^\\d+_.+/"  // Only for ordinal files
  }
]
```

### Key Implementation Notes
- **Order Preservation**: Unlike typical alphabetical sorting, maintains current numeric sequence
- **5-digit Zero Padding**: Ensures consistent `00010_` format for proper file explorer sorting
- **Gap Strategy**: 10-increment spacing allows easy manual insertion between items
- **Safety Validations**: Duplicate name detection, file existence checks, user confirmations
- **Error Handling**: Comprehensive try/catch with user-friendly error messages

### Display Label Stripping
```typescript
// Existing logic already handles ordinal prefix removal for display
fileName.replace(/^[\d_]+/, ''); // Strip "0001_" prefixes from labels
```

This ordinal system enables project phase organization, sequential task management, and ordered file workflows while maintaining the extension's core task management functionality.

## Extension Points for New Features

### Adding New Filters
1. Extend `TaskProvider` filter state properties
2. Update `filterPriority` command QuickPick options  
3. Modify `updateTreeViewTitle()` format logic
4. Implement filter logic in `scanForTaskFiles()` and `applyFiltersToExistingData()`

### New Task Metadata
1. Parse during `scanFile()` → extend `TaskFile` class
2. Mirror parsing in `updateSingleTask()` 
3. Update display logic in tree item creation
4. Consider impact on sorting and filtering

### Performance Improvements
Prefer `rebuildTaskDisplay()` pattern over full rescans for operations that only change display/filtering of existing data.

## Common Pitfalls

1. **Regex Updates**: Timestamp parsing regex appears in multiple files—update all locations
2. **Filter State**: Always clear search query when changing other filters (UX consistency)
3. **File Watcher**: Don't forget `hideScanningIndicator()` after async operations
4. **Duplicate Prevention**: `scannedFiles` Set prevents duplicate processing—clear on full scans
5. **Context Values**: TreeItem `contextValue` controls right-click menu availability (timestamp vs no-timestamp)

## Example Task Files

**Minimal (filename-derived label):**
```markdown
#todo [09/30/2025 05:00:00 PM] #p2
```

**Full content:**
```markdown
# Fix Login Bug

The login form is not validating email addresses properly.

#todo [09/12/2025 02:00:00 PM] #p1

## Steps to reproduce
- Enter invalid email format  
- Click login button
- Page hangs indefinitely
```