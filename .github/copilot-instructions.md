# AI Agent Guide: Timex VS Code Extension

Essential knowledge for AI coding agents to be immediately productive in this markdown-based task management extension.

## Core Purpose
Lightweight VS Code extension that transforms markdown files into a chronological task manager. Scans workspace for `.md` files containing configurable hashtags (default `#todo`), extracts timestamps and priorities, displays them in a filterable tree view with due-date proximity indicators.

## Architecture Overview

### Entry Point (`src/extension.ts`)
- **Commands Registration**: 27+ commands from timestamp insertion to AI writing assistance
- **File Watcher**: Real-time `.md` file monitoring with 100ms debounce
- **Tree View Setup**: Wires `TaskProvider` to VS Code's tree view API
- **Filter Panel Integration**: Opens `TimexFilterPanel` webview for combined priority and time filtering
- **Timestamp Manipulation**: `addTimeToTask()` preserves original format (date-only vs full datetime)
- **AI Writer Activation**: Calls `activateWriter()` to register chat participant and writer commands

### Data Layer (`src/model.ts`)
- **TaskProvider**: Main data provider implementing `vscode.TreeDataProvider<TaskFileItem>`
- **TaskFile**: Raw parsed data (filePath, timestamp, priority, completion status)  
- **TaskFileItem**: VS Code TreeItem with display formatting and tooltips
- **State Management**: In-memory arrays (`taskFileData`, `taskFiles`) + filter state
- **Performance Strategy**: `updateSingleTask()` for targeted updates vs full `scanForTaskFiles()`

### Filter Panel (`src/filterPanel.ts`)
- **TimexFilterPanel**: Singleton webview panel for combined filtering with integrated search
- **UI Architecture**: Persistent dialog with two-column CSS Grid layout (Priority | Time filters) plus search field
- **Radio Button Groups**: `getPriorityFilterRadioGroup()` (5 options) + `getTimeFilterRadioGroup()` (7 options)
- **Message Passing**: Webview → Extension communication via `vscode.postMessage()` with 'apply'/'clear'/'cancel' commands
- **Panel Persistence**: Panel stays open after "Search" button click (only "Close" button dismisses panel)
- **Resource Loading**: External CSS (`filterPanel.css`) and JavaScript (`filterPanelWebview.js`) with static caching
- **State Persistence**: Shows currently selected filters as checked radio buttons and current search text on panel open

### Configuration (`package.json`)
Two workspace settings:
- `timex.primaryHashtag`: Active hashtag for filtering (default `#todo`)
- `timex.hashtags`: Available hashtags for picker (default `#todo, #todo, #note`)

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
- **UI Method**: Click filter (funnel) icon → opens `TimexFilterPanel` persistent panel with side-by-side radio button sections plus search field
- **Panel Buttons**: 
  - "Search" button: Applies all filters and search criteria, **panel stays open** for further adjustments
  - "Clear" button: Resets all filters to defaults and clears search, **panel stays open**
  - "Close" button: Dismisses the panel (only button that closes it)
- **Filter combinations**: View (All|Due in 7/14/30 Days|Due Today|Future|Overdue) × Priority (all|p1|p2|p3|none) × Search text
- **Priority filters** (left column in panel): 
  - `PriorityTag.Any`: All priorities (default)
  - `PriorityTag.High` (p1): High priority tasks
  - `PriorityTag.Medium` (p2): Medium priority tasks
  - `PriorityTag.Low` (p3): Low priority tasks
  - `PriorityTag.None` (none): Tasks without any priority tag - filters for files where `priority === ''`
- **Time-based filters** (right column in panel): Three configurable horizons for planning:
  - `DueIn7Days`: Today through next 7 days (weekly view)
  - `DueIn14Days`: Today through next 14 days (bi-weekly planning)
  - `DueIn30Days`: Today through next 30 days (monthly overview)
- **Search field**: Located in filter panel itself (top section), searches filename + content matching, case-insensitive
- **Apply workflow**: "Search" button applies priority AND view filters AND search text simultaneously via callback handler, panel remains open
- **State clearing**: "Clear" button resets all filters and clears `currentSearchQuery`
- **Title sync**: `updateTreeViewTitle()` reflects all active filters including search query

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
npm install           # Install dependencies (or yarn install)
npm run compile       # TypeScript → out/
npm run watch         # Auto-rebuild on changes (background task available)
npm run test:unit     # Run Mocha unit tests for pure functions
npm run test:all      # Run all tests (unit + VS Code integration)
```

### Testing Strategy
**Two-tier testing approach:**
- **Unit Tests** (`src/test/unit/*.test.ts`): Functions in `utils.ts` (date parsing, formatting, calculations)
  - Use Mocha + Node.js assert (no VS Code APIs)
  - Fast, no extension host required
  - Run with `npm run test:unit` or `npm run test:unit -- --watch`
- **Integration Tests**: Functions using VS Code API (file I/O, workspace, tree view)
  - Require Extension Development Host environment
  - More complex setup, slower execution

**Code Organization Pattern:**
```typescript
// src/utils.ts - Functions without VS Code dependencies
export function parseTimestamp(str: string): Date | null { ... }
export function getDaysDifference(date1: Date, date2: Date): number { ... }

// src/utils.ts - VS Code-dependent utilities
import * as vscode from 'vscode';
export function getIncludeGlobPattern(): string { 
  const config = vscode.workspace.getConfiguration('timex');
  // ...
}
```

### Debug Setup
- **F5**: Launch Extension Development Host (clean VS Code instance)
- **Test Strategy**: Open external workspace folder with `.md` files (don't create test files in this repo)
- **Extension logs**: Help → Toggle Developer Tools → Console
- **Test File Debugging**: Set breakpoints in `src/test/unit/*.test.ts` and run debug task

### Packaging & Distribution
```bash
npm install -g @vscode/vsce
vsce package                    # Creates .vsix file
code --install-extension timex-0.0.2.vsix
# Or use convenience script:
./install.sh                    # Automated build + install
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

### Configuration System (NEW)
**Glob Patterns for Scanning** (`package.json` → `contributes.configuration`):
- `timex.includeGlobs`: Files to scan (default `**/*.md`)
- `timex.excludeGlobs`: Directories to skip (default: node_modules, .git, etc.)
- **Implementation**: `getIncludeGlobPattern()` and `getExcludeGlobPattern()` in `utils.ts`
- **Dynamic Normalization**: Trims whitespace, filters empty entries, wraps multiple patterns in `{}`
- **Fallback Logic**: Empty include list → default to `**/*.md`; empty exclude list → scan everything

```typescript
// File watching uses dynamic glob pattern
const watcherPattern = getIncludeGlobPattern(); // e.g., "**/*.md" or "{**/*.md,**/*.mdx}"
const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern);
```

### Attachment Management System (ADVANCED)
**Hash-based file tracking** prevents broken links when files move:

**Editor Context Menu Structure** (for image insertion):
- Right-click in markdown file → "Timex" submenu → "Insert Image From..." submenu
  - **"Disk"**: Opens file picker to select an image from filesystem (`timex.insertAttachment`)
  - **"Clipboard"**: Pastes image directly from system clipboard (`timex.insertImageFromClipboard`)

```typescript
// Core attachment workflow (extension.ts:insertAttachment)
1. User selects file via file picker
2. Generate SHA-256 hash of file content (first 128 bits → hex)
3. Rename file: "screenshot.png" → "screenshot.TIMEX-a3f5b2c8d9e1f4a7.png"
4. Insert markdown link with relative path from current file
5. Auto-detect images (IMAGE_EXTENSIONS set) → use "![...](...)" syntax

// Link repair workflow (extension.ts:fixLinks)
1. Build index: 
   - Scan for TIMEX-{hash} files (attachments)
   - Scan for files containing <!-- GUID:{guid} --> (file links)
2. Parse all markdown files in the project for:
   - TIMEX_LINK_REGEX matches (images)
   - TARGET-GUID matches (file links)
3. Track referenced hashes in Set during markdown scanning
4. For broken image links: Extract hash, lookup in attachment index, update path
5. For broken file links: Extract GUID, lookup in file index, update path
6. Update link inline (preserves alt text and link label)
7. Detect orphans: compare attachment index against referenced hashes
8. Rename unreferenced files: add "ORPHAN-" prefix if not already present
9. Report: links fixed count + orphans found count
```

**Critical Regex** (`TIMEX_LINK_REGEX` in utils.ts):
```typescript
/(!?\[[^\]]*\])\(([^)]*TIMEX-[a-f0-9]+[^)]*)\)/g
// Captures: [1] = link text with brackets, [2] = path with TIMEX-hash
```

**File Link Regex** (in `fixLinks`):
```typescript
/<!--\s*TARGET-GUID:([a-f0-9]{32})\s*-->(\s*)\[([^\]]*)\]\(([^)]*)\)/g
// Captures: [1] = GUID, [2] = whitespace, [3] = link text, [4] = link URL
```

**Clipboard Image Insertion** (`insertImageFromClipboard`):
- **Menu path**: Timex → Insert Image From... → Clipboard
- **Platform dependencies**: Linux=xclip, macOS=pngpaste, Windows=native
- Reads binary from clipboard, saves as PNG with TIMEX hash name
- Uses same hash-based naming → benefits from link repair
- Insert point: cursor position in active text editor

**Index Generation** (`generateMarkdown`):
- Prompts user for mode: "Multiple Index Files (Recursive)" or "Single Index File (Flattened)"
- **Multiple Mode**:
  - Walks ordinal folders recursively
  - Generates `_index.md` in every folder
  - Folder links: extracts first meaningful line from child `_index.md` as label
- **Single Mode**:
  - Generates one `_index.md` at root
  - Flattens all content recursively
  - Adjusts image paths to be relative to root
  - Uses folder names as section headers
- Concatenates `.md` files in ordinal order with `---` separators
- Embeds images using `![](...)` syntax (checks IMAGE_EXTENSIONS)
- Opens top-level index in Markdown preview (not editor)

## Ordinal-Based File Management (NEW)

Recent addition providing file organization capabilities using numeric prefixes.

### Commands Added
- `timex.renumberFiles` - "Re-Number Files" 
- `timex.insertOrdinalFile` - "New File" (in Insert... submenu)
- `timex.insertOrdinalFolder` - "New Folder" (in Insert... submenu)
- `timex.moveFileToFolder` - "File into Folder" (in Insert... submenu)

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

### Insert... Submenu Workflow  
The "Insert..." submenu appears when right-clicking ordinal files/folders and contains:
- **New File**: Creates a new `.md` file with the next ordinal
- **New Folder**: Creates a new folder with the next ordinal
- **File into Folder**: Wraps a markdown file into its own folder (separated by divider)

**New File/Folder workflow:**
1. Right-click on ordinal item (e.g., `00020_requirements.md`)
2. Select Timex → Insert... → "New File" or "New Folder"
3. Prompts user for name
4. Parses current ordinal (20), increments (+1 = 21)
5. Creates `00021_name.md` or `00021_name/` in same directory
6. Opens new file in editor / reveals new folder in Explorer

### Menu Integration
```json
// package.json - Submenu structure
"submenus": [
  { "id": "timex.explorerInsert", "label": "Insert..." }
],
"timex.explorerInsert": [
  { "command": "timex.insertOrdinalFile", "group": "1_insert@1" },
  { "command": "timex.insertOrdinalFolder", "group": "1_insert@2" },
  { "command": "timex.moveFileToFolder", "group": "2_move@1" }  // Separator above
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

### Ordinal File Management - Advanced Patterns

**Cut/Paste by Ordinal** (NEW):
- **Context value**: `timex.hasOrdinalCutItem` controls paste visibility in explorer context menu
- **State management**: Global state key `'ordinalCutItem'` stores `{path: string, ordinal: number}`
- **Paste behavior**: Inserts cut item after selected ordinal, renumbers neighbors automatically
- **Implementation**: `cutByOrdinal()` stores, `pasteByOrdinal()` relocates + calls `renumberItems()`

**Move Up/Down** (NEW):
- Swaps numeric prefixes with adjacent ordinal item (preserves rest of filename)
- Edge cases: No-op at top/bottom, shows information message
- Uses `extractOrdinalFromFilename()` and `generateNumberPrefix()` for atomic swaps
- **Pattern**: `00020_file.md` + Move Down → swaps with `00030_next.md`

**Order Preservation in Re-numbering**:
```typescript
// CRITICAL: Does NOT sort alphabetically - preserves existing numeric order
numberedItems.sort((a, b) => a.ordinal - b.ordinal); // Sort by current numbers
// Then renumber 00010, 00020, 00030... maintaining that sequence
```

**Numbered Item Detection**:
```typescript
// Regex: /^(\d+)_(.*)$/
// Matches: "001_file.md", "00020_folder", "12345_anything"
// Skips: Hidden files (startsWith('.' or '_')), non-ordinal names
// Operates on workspace root only (non-recursive for renumber command)
```

## Extension Points for New Features

### Adding New Filters
1. Add new enum value to `ViewFilter` or `PriorityTag` in `src/constants.ts`
2. Create corresponding `refresh*()` method in `TaskProvider` (e.g., `refreshDueIn7Days()`)
3. Update radio button groups in `src/filterPanel.ts` (`getPriorityFilterRadioGroup()` or `getTimeFilterRadioGroup()`)
4. Update the switch statement in the `openFilterPanelCommand` callback handler in `src/extension.ts`
5. Implement filter logic in both `scanForTaskFiles()` and `applyFiltersToExistingData()` 
6. Update `updateTreeViewTitle()` to display new filter in title bar

### New Task Metadata
1. Parse during `scanFile()` → extend `TaskFile` class
2. Mirror parsing in `updateSingleTask()` 
3. Update display logic in tree item creation
4. Consider impact on sorting and filtering

### Performance Improvements
Prefer `rebuildTaskDisplay()` pattern over full rescans for operations that only change display/filtering of existing data.

## Common Pitfalls

1. **Regex Updates**: Timestamp parsing regex (`TIMESTAMP_REGEX` in `utils.ts`) must match formats in multiple files
2. **Filter State**: Always clear search query when changing other filters (UX consistency)
3. **File Watcher**: Don't forget `hideScanningIndicator()` after async operations
4. **Duplicate Prevention**: `scannedFiles` Set prevents duplicate processing—clear on full scans
5. **Context Values**: TreeItem `contextValue` controls right-click menu availability (timestamp vs no-timestamp)
6. **Filter Method Signatures**: `scanForTaskFiles()` accepts different parameter combinations for different filters—check existing calls before modifying
7. **Dual Filter Logic**: Time-based filters must be implemented in BOTH `scanForTaskFiles()` (for full scans) AND `applyFiltersToExistingData()` (for in-memory filtering). Priority filters must check for special case `PriorityTag.None` which filters for empty string priority (`priority === ''`)
8. **Filter Panel Persistence**: Only the "cancel" message handler calls `this.panel.dispose()` to close the panel. The "apply" and "clear" handlers do NOT dispose the panel, allowing it to stay open for multiple filter adjustments
9. **Hash Filename Pattern**: TIMEX attachment filenames MUST follow `name.TIMEX-{hash}.ext` pattern (not `name-TIMEX-{hash}.ext` or other variations)
10. **Clipboard Platform Dependencies**: `insertImageFromClipboard` requires external tools (xclip/pngpaste)—graceful error handling needed
11. **Pure vs VS Code Functions**: Keep `utils.ts` free of `import * as vscode` to maintain unit testability
12. **Ordinal File State**: `timex.hasOrdinalCutItem` context value must be set/cleared via `context.setContext()` for paste menu visibility
13. **Relative Path Calculations**: Attachment links use `path.relative()` from markdown file location—handle edge cases with nested folders
14. **Orphan Detection**: `fixLinks` tracks referenced hashes during project-wide markdown scan—must extract hash from ALL links (broken or not) to accurately identify orphans
15. **Search Field Location**: Search functionality is integrated into the filter panel webview itself, not a separate icon/menu on the task panel. All search input happens within the filter panel UI

## AI Writer - Collaborative Writing Assistant

The AI Writer is an integrated chat participant and command suite for collaborative AI-assisted writing using a structured HTML comment syntax.

### Core Concept
AI Writer uses a block-based syntax with HTML comments to separate human input from AI-generated output:
```markdown
<!-- p -->
Human-written draft or outline content goes here.
This is the "P" (Paragraph/Prompt) section.
<!-- a -->
AI-generated content appears here.
This is the "A" (AI) section.
<!-- e -->
```

### Module Location (`src/writer/writer.ts`)
- **activateWriter()**: Main entry point called from `extension.ts`
- **Chat Participant**: Registers `@writer` chat participant with VS Code
- **Commands**: 10 commands all prefixed with `timex.writer*`
- **Prompt Files**: Default prompts in `src/writer/prompts/`

### Chat Participant (`@writer`)
Registered with ID `timex.writer`, provides three slash commands:
- **`/draft`**: Generate content from a draft (paraphrasing mode)
- **`/outline`**: Generate content from bullet-point outline
- **`/verify`**: Check if AI section contains all details from P section

**Usage Pattern**:
1. User places cursor inside a `<!-- p --> ... <!-- e -->` block
2. Invokes `@writer /draft` or `@writer /outline` in chat
3. AI processes the P section content with appropriate prompt
4. Response includes "Insert into Document" button to replace A section

### Commands

**Editor Context Commands** (directly on Timex menu, with divider above):
- `timex.writerGenerateFromDraft`: "AI: Gen. from Draft" - Opens chat with `@writer /draft`
- `timex.writerGenerateFromOutline`: "AI: Gen. from Outline" - Opens chat with `@writer /outline`
- `timex.writerVerify`: "AI: Verify" - Opens chat with `@writer /verify`

**Explorer Context Commands** (Timex → AI Writer submenu):
- `timex.writerRemovePSections`: Removes all P sections, keeps A content
- `timex.writerRemoveASections`: Removes all A sections, keeps P content
- `timex.writerHidePSections`: Toggles P visibility (modifies comment syntax)
- `timex.writerHideASections`: Toggles A visibility (modifies comment syntax)
- `timex.writerAddToContext`: Adds file to `AI-WRITER-CONTEXT.md`

**Other Commands**:
- `timex.writerInsertTemplate`: Inserts empty block template at cursor
- `timex.writerInsertResponse`: Internal command for "Insert into Document" button

### Prompt System
**Default Prompts** (bundled with extension in `src/writer/prompts/`):
- `AI-WRITER-GEN-FROM-DRAFT.md`: Paraphrasing instructions for `/draft` command
- `AI-WRITER-GEN-FROM-OUTLINE.md`: Outline expansion instructions for `/outline` command
- `AI-WRITER-VERIFY.md`: Verification instructions for `/verify` command (placeholder: `{CONTENT}`)
- `AI-WRITER-CONVERSATION.md`: General conversation instructions when no command specified (placeholder: `{USER_MESSAGE}`)

**Workspace Overrides** (optional, in workspace root):
- `AI-WRITER-GEN-FROM-DRAFT.md`: Custom draft prompt
- `AI-WRITER-GEN-FROM-OUTLINE.md`: Custom outline prompt
- `AI-WRITER-VERIFY.md`: Custom verify prompt
- `AI-WRITER-CONVERSATION.md`: Custom conversation prompt
- `AI-WRITER-ROLE.md`: Additional persona/role instructions (appended)
- `AI-WRITER-CONTEXT.md`: Additional context files (links expanded inline)

**Prompt Loading Priority**:
```typescript
1. Check workspace root for custom prompt file
2. If not found, load from extension's out/writer/prompts/
3. Append AI-WRITER-CONTEXT.md content (with link expansion)
4. Append AI-WRITER-ROLE.md content
```

### Context File Processing
`AI-WRITER-CONTEXT.md` supports markdown links that get expanded:
```markdown
# Custom Context
[config](src/config.ts)
[readme](docs/README.md)
```
Links are replaced with file contents wrapped in `<context_file>` tags.

### Hide/Show Mechanism
Toggling visibility modifies comment syntax:
```markdown
<!-- p -->  →  <!-- p -- >   (hidden)
<!-- a -->  →  <!-- a -- >   (hidden)
```
This allows markdown renderers to show/hide sections while preserving content.

### Block Detection (`findWriterBlock`)
```typescript
// Regex: /<!--\s*p\s*-->([^]*?)<!--\s*e\s*-->/g
// Finds blocks where cursor is positioned
// Extracts P content (between <!-- p --> and <!-- a -->)
// Returns: { pContent, fullBlock, range }
```

### Auto-Block Creation
If no block exists but text is selected:
```typescript
// Selection: "My draft text"
// Becomes:
<!-- p -->
My draft text
<!-- a -->
<!-- e -->
```

### Menu Structure
AI Writer commands appear in the Timex menus:
- **Editor context**: Right-click → Timex → [AI: Gen. from Draft, AI: Gen. from Outline, AI: Verify] (directly on menu with divider above)
- **Explorer context**: Right-click → Timex → AI Writer → [Remove/Hide P/A sections, Add to Context]

### Build Configuration
Prompts must be copied to output directory:
```json
// package.json scripts
"copy-resources": "... && mkdir -p out/writer/prompts && cp src/writer/prompts/*.md out/writer/prompts/ ..."
```

### Key Implementation Notes
- Uses VS Code Language Model API (`vscode.lm.selectChatModels`)
- Prefers GPT-4 family models, falls back to any available model
- Stream-based response handling for real-time output
- Button command uses range-based block re-detection for accuracy

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