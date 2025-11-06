# Timex - VSCode Extension

**Use Markdown files as your Calendar/Task Manager, in a time-series Panel**

A minimalist, flexible panel for managing markdown-based items (tasks, todos, notes, reminders) using lightweight hashtags and timestamps in your files. You can define multiple hashtags (e.g. `#todo`, `#note`) and switch the **active primary hashtag** live; only files containing the active one are listed. 

![Task Panel Screenshot](task-panel-screenshot.png)

## Quick Start (2‑Minute Tour)

Think of this extension as a lightweight, chronological stream of dated (or undated) markdown “items” — more like a rolling time‑aware list than a traditional calendar grid.

1. Create or open a workspace folder.
2. Click the Activity Bar icon (checklist) to open the panel.
3. Press the + button: you'll be prompted to enter a filename, then a new file appears with a timestamp and `#p3`.
4. Type a short description under the prefilled line (or just rename the file — filename can become the label).
5. (Optional) Switch the primary hashtag via the tag icon (e.g. from `#todo` to `#note`) to view a different stream.
6. Use the filter (funnel) icon for time-based filters (7/14/30 days) / Overdue / priority slices; search (🔍) narrows further.
7. Add or edit timestamps manually or with +Day/+Week/+Month/+Year commands.

You now have a living time series of work: closest due items float to your attention; undated or far‑future items sit quietly at the bottom (sentinel date logic). Switch hashtags to pivot context without noise.

### Minimal Example
```markdown
#todo [09/30/2025 05:00:00 PM] #p2
```
Filename: `plan-sprint.md` → Displays as: `🟠 (3) Plan sprint` (if 3 days out)

### Legend
- Priority Icons: 🔴 = P1 / 🟠 = P2 / 🔵 = P3 (absence = P1)
- Days Indicator: `(5)` in 5 days, `(0)` today, `(-2)` overdue by 2, `(?)` no date
- ⚠️ added after icon if overdue
- **Filter Coverage**: Overdue (past) ← Due Today (present) ← Due in 7/14/30 Days ← Future Due Dates (beyond)

### When to Use This vs a Calendar
- Need fast capture in plain files, not structured tasks
- Want sorting + proximity awareness without rigid scheduling
- Prefer grep‑able, versionable data over proprietary formats
- Maintain parallel streams (e.g. `#todo` for actionable, `#note` for reference, `#idea` for backlog)

Jump to: [Features](#features) · [How to Use](#how-to-use) · [Configuration](#configuration) · [Filtering & Search](#filtering--search)

**Examples:**
- `🔴 (1) Finish quarterly report` - Due tomorrow
- `🟠 (5) Review meeting notes` - Due in 5 days  
- `🔴⚠️ (-2) Update budget` - 2 days overdue
- `🟠 (0) Fix login bug` - Due today
- `🔴 (?) Plan vacation` - No due date specified

An “Item” (task / todo / note / reminder) is just a markdown file containing the currently active primary hashtag (default `#todo`). Optionally add a timestamp `[MM/DD/YYYY HH:MM:SS AM/PM]` or `[MM/DD/YYYY]` to give it a due date. The file is then auto‑indexed and displayed.


## Overview (how it works)

The extension scans your workspace for markdown files containing the active primary hashtag, extracts optional due dates, and displays them in a filterable, prioritized list with overdue indicators. Timex assumes that when it encounters a file containing the hashtag `#todo` (for example), that the entire file represents the definition of that task. So this extension should not be used to manage things like TODOs where you might have multiple `#todo` hashtags in the same file. This is because this extension assumes that each file represents only one single thing to be tracked. In other words, when your project is scanned and a tag like `#todo` is found in a file, that tells the extension the file itself is a task definition. 

## Features

- **Multi‑Hashtag Support**: Configure a comma list (default `#todo, #todo, #note`) and switch active context instantly.
- **Primary Hashtag Selector**: Tag icon opens a picker; selection updates the panel and title bar.
- **Dynamic Title Bar**: Shows current primary hashtag (e.g. `#todo - ALL - P*`).
- **Automatic Item Detection**: Scans `.md` files for active hashtag.
- **Optional Due Dates**: Recognizes `[MM/DD/YYYY HH:MM:SS AM/PM]` or `[MM/DD/YYYY]`.
- **Priority Tags**: `#p1 #p2 #p3` with sensible default to `#p1`.
- **Unified Filtering**: Priority + temporal (All / Due Soon / Overdue).
- **Integrated Search**: Filename + file content, layered atop current filters.
- **Relative Time Badges**: `(5)`, `(0)`, `(-2)`, `(?)` sentinel for no date.
- **Quick Create**: + button prompts for filename, then creates new file with active hashtag + timestamp + `#p3`.
- **Panel File Actions**: Right-click a task to reveal it in the Explorer or rename it without leaving the panel.
- **Timestamp Tools**: Insert current timestamp; add +Day/+Week/+Month/+Year.
- **Attachment Management**: Hash-based file attachment system with automatic link repair when files move.

## How to Use

### Creating Items (Tasks / Notes / Todos)

Quick: Click **+** in the panel header. A new file is created using the currently active primary hashtag (e.g. `#todo`) plus a timestamp and `#p3` priority.

Manual: Create a `.md` file that contains the active primary hashtag somewhere inside. Optionally add a timestamp for due date awareness. Priority + other hashtags are additive.

Required minimum for inclusion:
1. `.md` file
2. Contains the active primary hashtag (defaults to `#todo` until you switch)

Optional enhancements:
- Timestamp `[MM/DD/YYYY HH:MM:SS AM/PM]` or `[MM/DD/YYYY]`
- Priority `#p1/#p2/#p3`

**Example item file:**
```markdown
# Project Planning

Need to finish the quarterly report #todo #p1

## Due Date
[09/15/2025 05:00:00 PM]

## Notes
- Include sales figures
- Review with team lead
```

Only the presence of the active hashtag matters for indexing. Everything else is optional metadata.

## Ordinal-Based File Organization

Timex includes a powerful file organization feature that helps you maintain ordered sequences of files and folders using numeric prefixes. This is particularly useful for organizing project phases, sequential tasks, or any workflow where order matters.

### How Ordinal Numbering Works

Files and folders can be prefixed with numbers followed by an underscore to establish their order:

```
00010_project-setup.md
00020_requirements-gathering.md  
00030_design-phase.md
00040_development.md
00050_testing.md
```

The ordinal prefixes serve two key purposes:
1. **Visual Organization**: Files appear in logical sequence in your file explorer
2. **Flexible Insertion**: Large gaps (10, 20, 30...) make it easy to insert new items between existing ones

### Re-Number Files Feature

Access this feature by **right-clicking in the VS Code file explorer** and selecting **"Re-Number Files"**.

#### What It Does
- Scans the workspace root for files and folders starting with digits followed by underscore (e.g., `001_`, `123_`)
- Preserves the existing order of items
- Renumbers them with consistent 5-digit prefixes starting at `00010` and incrementing by 10
- Maintains proper spacing for future insertions

#### Example Transformation

**Before renumbering:**
```
1_project-setup.md
23_requirements.md  
100_design.md
105_wireframes.md
200_development.md
```

**After renumbering:**
```
00010_project-setup.md
00020_requirements.md
00030_design.md
00040_wireframes.md
00050_development.md
```

#### Key Features

- **Order Preservation**: Maintains your existing file sequence—no alphabetical resorting
- **Duplicate Name Detection**: Prevents renaming when multiple files would have identical names (ignoring ordinal prefixes)
- **Smart Skipping**: Files already correctly numbered are left unchanged
- **Safety First**: Shows confirmation dialog with count of files to be renamed
- **Progress Feedback**: Visual progress indicator during the renumbering process

#### Best Practices

1. **Start with Gaps**: Use increments of 10 (00010, 00020, 00030) to leave room for insertions
2. **Insert Between**: Add new files like `00015_new-task.md` between existing items
3. **Renumber Periodically**: Run the renumber command when gaps get too small or numbering becomes inconsistent
4. **Consistent Naming**: Ensure file names after the underscore are unique to avoid conflicts

#### Workflow Example

1. Create initial files: `001_start.md`, `002_middle.md`, `003_end.md`
2. Add urgent task between start and middle: `0015_urgent-fix.md`
3. Right-click in file explorer → "Re-Number Files"
4. Result: `00010_start.md`, `00020_urgent-fix.md`, `00030_middle.md`, `00040_end.md`

### Insert File Feature

For rapid file creation within your ordinal sequence, use the **"Insert File"** feature.

#### How to Use
1. **Right-click on any ordinal file** (e.g., `00020_requirements.md`)
2. Select **"Insert File"** from the context menu
3. A new file is automatically created with the next ordinal number: `00021_new.md`
4. The new file opens immediately in the editor, ready for editing

#### Example Usage
- Selected file: `00020_requirements.md`
- Created file: `00021_new.md`
- You can then rename it to something meaningful like `00021_user-stories.md`

#### Key Benefits
- **Automatic Numbering**: No need to calculate the next ordinal manually
- **Instant Creation**: File is created and opened in one action
- **Perfect Insertion**: Places new files exactly where you want them in the sequence
- **Context Aware**: Only appears when right-clicking on files with ordinal prefixes

This feature makes it incredibly fast to expand your ordinal file structure—simply right-click where you want to insert a new item, and it's ready for editing immediately.

### Move Up / Move Down Commands

Need to tweak the order without renumbering everything? Use the **Move Up** and **Move Down** commands in the **Timex** submenu (right-click any ordinal file or folder in the Explorer). Each action swaps the numeric prefixes of the selected item and its immediate neighbor:
- **Move Up** finds the closest ordinal above the selection and swaps prefixes, shifting the item earlier in the sequence
- **Move Down** swaps with the next ordinal below, pushing the item later in the list

These commands work for both files and folders that follow the ordinal pattern (`00010_name`). They are safe to use at the edges: if there is no item above or below, a friendly message lets you know nothing changed.

This system gives you the benefits of ordered organization while maintaining the flexibility to reorganize as your project evolves.

### Generate Markdown Indexes

The **Generate Markdown** command (Explorer → Timex submenu) assembles a consolidated `_index.md` that reflects your entire ordinal hierarchy.

- Always runs from the workspace root for the folder that contains the item you clicked (or the first workspace when launched elsewhere)
- Walks every ordinal folder recursively; any folder that contains at least one ordinal item gets its own `_index.md`
- Markdown files are concatenated in ordinal order exactly as they exist on disk (trailing blank lines trimmed)
- A horizontal rule (`---`) is inserted after each markdown file so you can see clear boundaries between entries
- Image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.svg`, `.webp`, `.tif`, `.tiff`, `.avif`) are embedded automatically using standard Markdown image syntax
- Folders appear as heading links that point to their freshly generated `_index.md`; the link label comes from the first meaningful line in that file, falling back to the folder name without its ordinal prefix
- Folders with no ordinal content are skipped entirely, so you will not see empty `_index.md` files
- When generation completes, the command opens the top-level index in the Markdown preview so you immediately see the rendered roll-up (no editor tab required)

Tip: re-run the command whenever you add, reorder, or update ordinal files to refresh every `_index.md` in one shot.

#### Minimal Filename-Driven Items

If the file has only a single non-empty line (starting with `#` or `[`), the filename (sans extension and numeric/underscore prefix) becomes the display label.

Example:
- Filename: `fix-login-bug.md`
- Contents: `#todo [09/15/2025 05:00:00 PM]`
- Result: Appears as “Fix login bug”.

Great for ultra-fast capture—just create a descriptively named file with the hashtag.

## Configuration

Settings (File > Preferences > Settings > Extensions > Timex):

| Setting | Default | Description |
|---------|---------|-------------|
| `timex.primaryHashtag` | `#todo` | Active hashtag scanned for actionable items. Change via the tag toolbar icon or directly here. |
| `timex.hashtags` | `#todo, #note, #idea` | Comma‑separated candidate hashtags available in the selection picker. Whitespace trimmed; empty entries ignored. |
| `timex.newTaskFolder` | (empty) | Absolute path to folder where new task files will be created. Leave empty to create in workspace root. |
| `timex.includeGlobs` | `**/*.md` | Glob patterns included when scanning the workspace. Empty list falls back to the default. |
| `timex.excludeGlobs` | `**/node_modules/**`, `**/.git/**`, `**/.vscode/**`, `**/out/**`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/target/**` | Glob patterns skipped while scanning for markdown items. Empty list scans every folder. |

Behavior Notes:

1. Changing `primaryHashtag` triggers a rescan (only files containing the new hashtag are considered items).
2. The list in `hashtags` does not auto‑switch context; it just feeds the picker.
3. Remove or add custom hashtags (e.g. `#idea`, `#errand`) without restarting—selector reflects changes immediately.
4. If `primaryHashtag` is not present in `hashtags`, it is still honored (useful for temporary experiments).
5. Adjust `includeGlobs` / `excludeGlobs` to fine-tune which files are scanned (e.g., add project-specific directories or alternate extensions).

- **`timex.newTaskFolder`**: Specifies the folder where new task files are created when using the + button
  - **Type**: String
  - **Default**: `""` (workspace root)
  - **Example values**: `"/home/user/tasks"`, `"/tmp/my-tasks"`, `"~/Documents/Tasks"`
  - **Note**: Supports absolute file system paths. For relative paths (backward compatibility), they are resolved relative to workspace root. The folder will be created automatically if it doesn't exist.

Quick Access:
You can also set or change this value without opening Settings via the panel:
- Open the panel, then either:
  - Click the panel title menu (three dots) and select "Folder for New Tasks...", or
  - Right‑click inside the panel (empty space or an item) and choose "Folder for New Tasks...".
This opens an input box and updates the `timex.newTaskFolder` setting directly.

Need to adjust which folders are scanned? Use **Configure Excluded Paths...** from the same menu to jump straight to the list editor in Settings.
Want to expand beyond markdown? Use **Configure Included Paths...** to add additional glob patterns (e.g., `**/*.mdx`).

To access settings:
1. Open VSCode Settings (File → Preferences → Settings, or Ctrl+Shift+P then type "Preferences: Open Settings")
2. Search for "timex" (or legacy: "task manager")
3. Look for "New Task Folder" under the "Timex" section
4. Configure the folder path as needed

### Supported Hashtags

Core:
- Active Primary (configurable): marks a file as an actionable item (default `#todo`, switchable to any candidate like `#note`, `#idea`).
- `#p1`, `#p2`, `#p3` – High / Medium / Low priority (absence = treated as `#p1`).

Custom:
- Add your own in `timex.hashtags` (e.g. `#meeting, #research`). Switch via tag icon to focus a specific stream without changing underlying files.

Notes:
- Only one primary hashtag is active at a time.
- Items may contain multiple candidate hashtags; only the active one matters for visibility.
- You can maintain parallel “streams” of work (e.g. planning notes vs action tasks) and jump between them instantly.

### GUI Elements

#### Activity Bar Icon
- Left sidebar; opens the panel.

#### Primary Hashtag Selector (Tag Icon)
- Location: Panel title bar (leftmost icon with a tag symbol).
- Action: Opens a QuickPick of configured candidate hashtags (from `timex.hashtags`).
- Behavior: Selecting one updates `timex.primaryHashtag`, refreshes the list, and rewrites title bar prefix.
- Visual: Currently selected hashtag shows a checkmark; others a hollow circle.

#### Items Panel
- Title: `<primaryHashtag> - <VIEW> - <PRIORITY>` plus search snippet when active.
- Content: Items derived from files containing the primary hashtag.

#### Filter Menu
Funnel icon; unified picker controlling two orthogonal groups (view / priority). Switching any filter clears active search.

#### Search Button
- Magnifying glass icon; layered filter on already in-memory items (case-insensitive). Title shows query until cleared.

**Search Examples:**
- Search for `"bug"` - finds files named `fix-login-bug.md` or files containing the word "bug"
- Search for `"review"` - finds any task with "review" in the filename or content
- Search for `"2025"` - finds tasks with "2025" in their timestamps or content

This feature is perfect for quickly finding specific tasks in large workspaces without having to browse through all tasks manually.

#### New Item Button
- + icon; prompts for filename and creates file with that name (automatically adds `.md` extension if not provided) in configured folder. Prefills with active hashtag + current timestamp + `#p3`.

Fastest capture path—click +, enter a descriptive filename, and start typing.

**Configuring Task Folder**: You can specify where new task files are created by setting the `timex.newTaskFolder` configuration. Go to VSCode settings (File → Preferences → Settings) and search for "timex" to find the "New Task Folder" setting. Enter an absolute file system path (e.g., "/home/user/tasks", "/tmp/my-tasks") or a relative path to your workspace root (e.g., "tasks", "todos", or "project/tasks"). Leave empty to create tasks in the workspace root.

#### Right-Click Context Menu

**In Text Editor:**
- **Location**: Any text editor
- **Menu**: Right-click → "Timex" submenu
- **Options**:
  - **Insert Date+Time**: Inserts current date and time in full timestamp format `[MM/DD/YYYY HH:MM:SS AM/PM]`
  - **Insert Date**: Inserts current date only in short format `[MM/DD/YYYY]`
- **Function**: Both commands insert at cursor position in the required bracket format

**In Panel:**
- **Location**: Right-click on any item in the panel
- **Options Available**:
  - **Folder for New Tasks...**: Quickly set or change the folder path used when creating new tasks via the + button (updates the `timex.newTaskFolder` setting)
  - **Date Extension Commands**: +Day, +Week, +Month, +Year (for tasks with timestamps)
  - **Reveal in Explorer**: Highlights the underlying file in VS Code's Explorer so you can see its location instantly.
  - **Rename**: Prompts for a new filename and renames the markdown file without switching to the Explorer.
  - **Delete**: Permanently removes the task file from your workspace
  - **About**: Shows extension information

**In Explorer:**
- Right-click any ordinal file or folder to open the Timex submenu of ordered-file tools.
- **Re-Number Files** rescans and normalizes prefixes across the root folder.
- **Insert File** adds a new ordinal item immediately after the selection.
- **Move Up** and **Move Down** swap prefixes with the previous or next ordinal neighbor.
- **Cut by Ordinal** and **Paste by Ordinal** let you relocate an item while shuffling surrounding ordinals automatically.

**Delete Feature:**
- Right-click any item in the panel and select "Delete"
- Shows a confirmation dialog before deletion
- Permanently removes the markdown file from your workspace
- Automatically refreshes the panel after deletion
- **Warning**: This action cannot be undone - the file will be permanently deleted

### Item Display Format

Items appear in the panel with a compact format showing days until due date in parentheses:
```
[emoji] ([days]) [task description]
```

The days indicator shows:
- **Positive numbers**: Days until due date (e.g., `(5)` = due in 5 days)
- **Zero**: Due today (`(0)`)
- **Negative numbers**: Days overdue (e.g., `(-3)` = 3 days overdue)
- **Question mark**: No due date specified (`(?)`)

The item description is either:
- The first non-blank line (leading `#` trimmed), OR
- The filename (without `.md`) if only hashtag + optional timestamp present.

**Examples:**
- `� (1) Finish quarterly report` - Due tomorrow
- `� (5) Review meeting notes` - Due in 5 days  
- `🔴⚠️ (-2) Update budget` - 2 days overdue
- `� (0) Fix login bug` - Due today
- `🔴 (?) Plan vacation` - No due date specified

### Filtering & Search

The panel offers a single unified filtering system plus search to refine what you see. All functionality related to filtering and searching is documented here (nowhere else) for simplicity.

#### Overview
- Open the filter picker via the filter (funnel) icon (one active choice per group; groups combine).
- Open search via the 🔍 icon (search text combines with the currently selected filters until cleared).
- Panel title shows current state (e.g., `Due Soon - P1`, or `SEARCH - P* - 'bug'`).

#### Filter Groups (11 Options Total)
1. (Priority) Any Priority – show every priority level
2. (Priority) Priority 1 – `#p1` (High priority)
3. (Priority) Priority 2 – `#p2` (Medium priority)
4. (Priority) Priority 3 – `#p3` (Low priority)
5. (View) Any Time – no due-date restriction
6. (View) Due in 7 Days – due today through next 7 days
7. (View) Due in 14 Days – due today through next 14 days
8. (View) Due in 30 Days – due today through next 30 days
9. (View) Due Today – due only today
10. (View) Future Due Dates – due tomorrow and beyond
11. (View) Overdue – past due date only (⚠️ shown)

#### Complete Temporal Coverage
The view filters provide flexible time-based views of your tasks:
- **Overdue**: Tasks past their due date (excludes today)
- **Due Today**: Tasks due specifically today
- **Due in 7 Days**: Tasks due from today through the next 7 days (includes today)
- **Due in 14 Days**: Tasks due from today through the next 14 days (includes today)
- **Due in 30 Days**: Tasks due from today through the next 30 days (includes today)
- **Future Due Dates**: Tasks due tomorrow and beyond
- **Any Time**: All tasks regardless of due date

The time-based filters (7/14/30 days) are designed to give you different planning horizons - use 7 days for immediate focus, 14 days for bi-weekly planning, or 30 days for monthly overview.

#### Using Filters
1. Click the filter (funnel) icon and pick one option in any group; previous selection in that group is replaced.
2. Combine one selection from each group for precise views (e.g., High + Due Today + Not Done).
3. Changing filters clears any active search automatically.
4. Overdue tasks always show the warning icon ⚠️.

**Filter Usage Examples:**
- **Due Today + Priority 1**: Focus on high-priority tasks due today
- **Due in 7 Days + Any Priority**: See what's coming up this week
- **Due in 14 Days + Priority 2**: Plan medium-priority work for the next two weeks
- **Due in 30 Days + Any Priority**: Get a monthly overview of upcoming tasks
- **Future Due Dates + Priority 2**: Plan medium-priority work for later
- **Overdue + Any Priority**: Review what needs immediate attention

#### Tips
- To review urgent items this week: select Due in 7 Days + Priority 1
- For bi-weekly planning: use Due in 14 Days to see two weeks ahead
- For monthly planning: use Due in 30 Days to get a full month overview
- Use Due Today for focus on today's tasks only
- Use Future Due Dates to plan ahead without current distractions
- Want everything regardless of status? Use Any Priority + Any Time and clear search

#### Search
| Aspect | Behavior |
|--------|----------|
| Trigger | Click 🔍 icon |
| Scope | Case-insensitive match in filenames and file content |
| Interaction with Filters | Search results are still constrained by active filters |
| Clearing | Run search with empty input OR change any filter |
| Performance | Uses in-memory task data (no full rescan) |

##### Effective Search Use-Cases
- Locate tasks by keyword (client, feature, bug ID)
- Narrow to a sprint window by searching a date fragment (e.g., `2025/09`)
- Combine with Priority 1 to focus critical items containing a term
- Use with Due Today to find specific tasks due today
- Combine with Future Due Dates to plan specific upcoming work

### Item Lifecycle

1. **Create**: Add active primary hashtag to a `.md` file (timestamp optional).
2. **Track**: Listed under that hashtag’s context.
3. **Switch Context**: Change primary hashtag to pivot to a different stream (notes vs tasks, etc.).
4. **Iterate**: Bump dates via +Day/+Week/+Month/+Year commands.

### Timestamp Format

**Supported formats**:

1. **Full timestamp**: `[MM/DD/YYYY HH:MM:SS AM/PM]` - for time-specific tasks
2. **Date-only**: `[MM/DD/YYYY]` - for day-specific tasks (assumes 12:00 PM)

**Full timestamp example:**
- `[12/25/2025 09:30:00 AM]`

**Date-only examples:**
- `[09/17/2025]` - Due at noon on September 17th

**Inserting timestamps:**
1. Place cursor where you want the timestamp
2. Right-click → "Timex" submenu
3. Choose either:
   - **"Insert Date+Time"** for full timestamp format (e.g., `[11/03/2025 02:30:00 PM]`)
   - **"Insert Date"** for date-only format (e.g., `[11/03/2025]`)
4. The timestamp is automatically inserted at cursor position

*Tip: Use "Insert Date" for tasks where the specific time doesn't matter, and "Insert Date+Time" when you need precise scheduling.*

## Attachment Management

Timex provides intelligent attachment management for markdown files, making it easy to embed images and other files while maintaining link integrity even when files are moved or renamed.

### How It Works

The extension uses a content-based hashing system to uniquely identify attachments. When you insert an attachment, Timex:
1. Generates a 128-bit SHA-256 hash of the file's contents
2. Renames the file to include the hash: `filename.TIMEX-{hash}.ext`
3. Inserts a properly formatted markdown link at your cursor position

**Example**: An image `screenshot.png` becomes `screenshot.TIMEX-a3f5b2c8d9e1f4a7b6c3d8e2f1a4b7c9.png`

### Inserting Attachments

1. Open a markdown file
2. Place cursor where you want the attachment link
3. Right-click → "Timex" submenu → "Insert Attachment"
4. Select the file from the file picker dialog
5. The file is renamed (if needed) and a markdown link is inserted

**Key Features:**
- **Automatic Image Detection**: Image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.svg`, `.webp`, `.tif`, `.tiff`, `.avif`) are inserted with `!` prefix for inline display
- **Smart Renaming**: Files already in the correct format (with `.TIMEX-{hash}`) are used as-is
- **Relative Paths**: Links use paths relative to the markdown file, not absolute paths
- **URL Encoding**: Automatically handles spaces and special characters in filenames

**Example inserted links:**
```markdown
![screenshot](../images/screenshot.TIMEX-a3f5b2c8d9e1f4a7.png)
[document](./files/report.TIMEX-b4c3d8e2f1a4b7c9.pdf)
```

### Insert Image from Clipboard

For rapid image insertion, use the **"Insert Image from Clipboard"** feature to paste screenshots and images directly into your markdown files.

**How to use:**
1. Copy an image to your system clipboard (e.g., take a screenshot)
2. Open a markdown file and place cursor where you want the image
3. Right-click → "Insert Image from Clipboard"
4. The image is automatically saved and linked into your document

**What happens:**
- Image data is read from the system clipboard
- A PNG file is created in the same directory as your markdown file
- File is named using the TIMEX convention: `img.TIMEX-{hash}.png`
- A markdown image link is inserted at your cursor: `![img](img.TIMEX-{hash}.png)`

**Platform requirements:**
- **Linux**: Requires `xclip` (install: `sudo apt install xclip`)
- **macOS**: Requires `pngpaste` (install: `brew install pngpaste`)
- **Windows**: No additional dependencies needed

**Example workflow:**
1. Press `PrtScn` or use a screenshot tool to capture part of your screen
2. In your markdown file, right-click and select "Insert Image from Clipboard"
3. Image appears inline immediately: `![img](img.TIMEX-a3f5b2c8.png)`

This feature is perfect for quickly documenting UI issues, capturing error messages, or adding visual context to your notes without the overhead of manually saving and linking image files.

### Fix Broken Attachment Links

When you move or reorganize files, attachment links may break. The "Fix Attachment Links" command automatically repairs them using the embedded hash codes.

**To use:**
1. Right-click on any file or folder in the Explorer
2. Select "Timex" submenu → "Fix Attachment Links"
3. The extension will:
   - Scan for all TIMEX-formatted attachments in the selected folder
   - Find all markdown files with attachment links
   - Detect broken links (files that have moved)
   - Automatically update links to the correct new location

**Smart Behavior:**
- **Folder Selection**: Scans the selected folder recursively
- **File Selection**: Scans the entire workspace root (convenient when right-clicking any file)
- **Hash Matching**: Uses content hash to find moved files, even if renamed
- **Progress Indicator**: Shows scanning and fixing progress
- **Results Report**: Displays number of links fixed and files modified
- **Missing Files Warning**: Lists any attachments that couldn't be found

**Example scenario:**
1. You move `screenshot.TIMEX-abc123.png` from `images/` to `assets/screenshots/`
2. Markdown links break: `![screenshot](../images/screenshot.TIMEX-abc123.png)`
3. Run "Fix Attachment Links" on project root
4. Links automatically update: `![screenshot](../assets/screenshots/screenshot.TIMEX-abc123.png)`

### Why Use Content Hashes?

The hash-based naming system provides:
- **Move Resilience**: Links can be repaired even when files move to different folders
- **Rename Resilience**: As long as the hash portion remains, links can be fixed
- **Deduplication**: Same content = same hash, making duplicate detection possible
- **Integrity**: Hash verifies file content hasn't changed

### Best Practices

1. **Always use "Insert Attachment"** instead of manually creating links - this ensures proper hash naming
2. **Run "Fix Attachment Links" after reorganization** - keeps all links working after moving files around
3. **Keep the hash intact** - the `.TIMEX-{hash}` portion is critical for link repair
4. **Rename the descriptive part freely** - you can change `screenshot` to `login-page` as long as `.TIMEX-{hash}` stays

**Supported file types**: Any file can be attached, but images get special treatment with the `!` prefix for inline display.

## Prioritization

Set priority per item using hashtags:

- `#p1` — **High Priority** (red icon)
- `#p2` — **Medium Priority** (orange icon)
- `#p3` — **Low Priority** (blue icon)

If no priority hashtag is present, treated as high priority (`#p1`).

### How Priorities Work
- The panel sorts items by due date (earliest first; undated sentinel last).
- Each item shows a colored icon indicating priority:
  - 🔴 High Priority (`#p1` or no priority tag)
  - 🟠 Medium Priority (`#p2`)
  - 🔵 Low Priority (`#p3`)
- Overdue adds ⚠️ after priority icon.
- Use filter system to isolate priority levels.

**Example:**
```
🔴⚠️ (-2) Finish urgent report
🟠 (1) Review documentation  
🔵 (5) Update website
```

**Priority Filtering**: Use the filter icon:
- **Any Priority**: Shows tasks of all priority levels (default)
- **Priority 1**: Shows only high-priority tasks
- **Priority 2**: Shows only medium-priority tasks  
- **Priority 3**: Shows only low-priority tasks

Add the priority hashtag anywhere inside the file.

## Developer Information

### Prerequisites
- Node.js (v14 or higher)
- npm
- VSCode (for testing)

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

### Building Distribution Package

1. **Install vsce** (VSCode Extension CLI):
```bash
npm install -g @vscode/vsce
```

2. **Package extension**:
```bash
vsce package
```

This creates a `.vsix` file ready for distribution.

3. **Install packaged extension**:
```bash
code --install-extension timex-0.0.2.vsix
```

### Quick Installation Script

For convenience, you can use the provided `install.sh` script which automates the entire build and installation process:

```bash
chmod +x install.sh
./install.sh
```

This script will:
1. Install npm dependencies
2. Compile the TypeScript code
3. Package the extension
4. Install it in VS Code

The script includes error handling and will stop with a descriptive message if any step fails.

### Key Dependencies
- `vscode`: VSCode Extension API
- `typescript`: Language support
- `@types/node`: Node.js type definitions

### Testing

This extension uses **Mocha** as the testing framework for unit tests. The testing infrastructure includes comprehensive test coverage for core utility functions like date parsing, timestamp formatting, and relative date calculations.

For detailed information about running tests, test structure, and testing best practices, see **[TESTING.md](TESTING.md)**.

Key testing commands:
```bash
# Run all unit tests
npm run test:unit

# Run tests in watch mode during development
npm run test:watch
```

The test suite covers pure utility functions (date/time operations, parsing logic) that don't depend on the VS Code API, making them easily testable in a Node.js environment.

## Troubleshooting

**Item not appearing?**
- Confirm active primary hashtag (title bar prefix) matches hashtag inside file.
- File must be `.md`.
- Timestamp (if present) must match one of supported formats exactly.

**Changed hashtag list but picker not updated?**
- Ensure entries are comma-separated; no stray semicolons.
- Empty tokens are ignored—double commas collapse.

**Relative days feel off?**
- Calculations are calendar-day based (midnight boundaries), not 24h rolling windows.

**Primary hashtag title didn’t update after settings edit?**
- Use the tag icon to re-select, or reload window (command: Reload Window).

**Still stuck?**
- Open Developer Tools (Help → Toggle Developer Tools) and check console for errors.

