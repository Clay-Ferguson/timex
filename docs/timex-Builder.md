# Timex: Document Builder

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

### Insert File / Insert Folder Features

For rapid file or folder creation within your ordinal sequence, use the **"Insert..."** submenu.

#### How to Use
1. **Right-click on any ordinal file or folder** (e.g., `00020_requirements.md`)
2. Select **Timex** → **"Insert..."** → **"New File"** or **"New Folder"**
3. Enter the name for your new file or folder when prompted
4. A new item is automatically created with the next ordinal number (e.g., `00021_my-name.md` or `00021_my-folder/`)
5. For files, the new file opens immediately in the editor; for folders, the folder is revealed in the Explorer

#### Example Usage
- Selected file: `00020_requirements.md`
- Choose **"New File"**: Creates `00021_your-name.md`
- Choose **"New Folder"**: Creates `00021_your-name/` folder

#### Key Benefits
- **Automatic Numbering**: No need to calculate the next ordinal manually
- **Instant Creation**: Files are created and opened in one action; folders are revealed in Explorer
- **Perfect Insertion**: Places new items exactly where you want them in the sequence
- **Context Aware**: Only appears when right-clicking on items with ordinal prefixes
- **Flexible**: Create either files or folders depending on your needs

This feature makes it incredibly fast to expand your ordinal file structure—simply right-click where you want to insert a new item, choose file or folder, and it's ready immediately.

### Move Up / Move Down Commands

Need to tweak the order without renumbering everything? Use the **Move Up** and **Move Down** commands in the **Timex** submenu (right-click any ordinal file or folder in the Explorer). Each action swaps the numeric prefixes of the selected item and its immediate neighbor:
- **Move Up** finds the closest ordinal above the selection and swaps prefixes, shifting the item earlier in the sequence
- **Move Down** swaps with the next ordinal below, pushing the item later in the list

These commands work for both files and folders that follow the ordinal pattern (`00010_name`). They are safe to use at the edges: if there is no item above or below, a friendly message lets you know nothing changed.

### File into Folder

The **File into Folder** command (Explorer → Timex → Insert... submenu) helps you organize your markdown files by wrapping them in a dedicated folder. This is perfect when you realize a single file needs to grow into a folder containing attachments or related resources.

**How to use:**
1. Right-click any markdown file in the Explorer
2. Select **Timex** → **"Insert..."** → **"File into Folder"**

**What it does:**
- Creates a new folder with the same name as your file (minus the `.md` extension)
- Moves your markdown file into that new folder
- **Smart Ordinal Handling**: If your file has an ordinal prefix (e.g., `00030_my-file.md`), the command:
  - Creates the folder with the full ordinal name (`00030_my-file`)
  - Renames the moved file to start the sequence inside the folder (`00010_my-file.md`)
  - This ensures your file becomes the first item in the new folder's sequence

**Example:**
- **Input**: `00030_vacation-plans.md`
- **Action**: Run "Move to Folder"
- **Result**:
  - Folder created: `00030_vacation-plans/`
  - File moved & renamed: `00030_vacation-plans/00010_vacation-plans.md`

This system gives you the benefits of ordered organization while maintaining the flexibility to reorganize as your project evolves.

### Generate Markdown Indexes

The **to _index.md files** command (Explorer → Timex → Generate Markdown submenu) assembles a consolidated `_index.md` that reflects your entire ordinal hierarchy.

When you run this command, you will be prompted to choose between two generation modes:

1. **Multiple Index Files (Recursive)**:
   - Creates an `_index.md` file in every folder that contains ordinal items
   - Maintains the folder hierarchy by linking parent index files to child index files
   - Best for complex documentation structures where you want to navigate through folders

2. **Single Index File (Flattened)**:
   - Creates a single `_index.md` file only in the top-level folder you selected
   - Recursively gathers content from all subfolders and aggregates it into this one file
   - Uses folder names as headings to separate sections
   - Automatically adjusts image paths to be relative to the root file
   - Best for creating a single long-form document (like a book or report) from many files

**Common Behavior:**
- Always runs from the workspace root for the folder that contains the item you clicked (or the first workspace when launched elsewhere)
- Walks every ordinal folder recursively
- Markdown files are concatenated in ordinal order exactly as they exist on disk (trailing blank lines trimmed)
- A horizontal rule (`---`) is inserted after each markdown file so you can see clear boundaries between entries
- Image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.svg`, `.webp`, `.tif`, `.tiff`, `.avif`) are embedded automatically using standard Markdown image syntax
- Folders with no ordinal content are skipped entirely
- When generation completes, the command opens the top-level index in the Markdown preview so you immediately see the rendered roll-up (no editor tab required)

Tip: re-run the command whenever you add, reorder, or update ordinal files to refresh your documentation.

### Preview Folder as Markdown

The **Preview** command (Explorer → Timex → Generate Markdown submenu) provides an instant, no-clutter way to view your ordinal content as a rendered document without creating any physical `_index.md` files on disk.

**How to use:**
1. Right-click any folder in the VS Code Explorer
2. Select **Timex** → **Generate Markdown** → **"Preview"**
3. A rendered markdown preview opens in a full editor tab showing the assembled content

**What it does:**
- Scans the folder recursively for ordinal files and subfolders
- Concatenates markdown files in ordinal sequence
- Embeds images inline automatically
- Displays child folders as heading links
- Shows everything in VS Code's native markdown preview
- **Never writes files to disk** - everything is virtual

**Key differences from "to _index.md files":**
- No physical `_index.md` files created
- Opens in preview tab, not editor
- Manual refresh (re-run command to update)
- Clean workspace - no generated files in search results

**Perfect for:**
- Quick review of ordinal documentation hierarchies
- Generating printable/exportable documents
- Previewing assembled content before committing
- Reading sequential content as a single flow

**Example use cases:**

This extension includes demo data that demonstrates the power of ordinal-based document organization:

- `demo-data/docs/calculus-intro/` - A calculus tutorial organized in 8 ordinal files covering introduction through applications
- `demo-data/docs/git-guide/` - A Git learning guide with 8 ordinal sections from basics to advanced tips

These folders showcase exactly why ordinal numbering exists: to transform a collection of ordered markdown files into readable, sequential documents. Try right-clicking on either folder and selecting Timex → Generate Markdown → "Preview" to see how individual topic files are assembled into a cohesive document flow.

The ordinal system ensures proper sequencing (00010, 00020, 00030...), making it trivial to:
- Insert new sections between existing ones
- Reorder topics as content evolves
- Maintain logical document structure
- Generate clean combined views on demand

**Note:** To manually refresh the preview after making changes to files, simply re-run the "Preview" command on the same folder.

#### Minimal Filename-Driven Items

If the file has only a single non-empty line (starting with `#` or `[`), the filename (sans extension and numeric/underscore prefix) becomes the display label.

Example:
- Filename: `fix-login-bug.md`
- Contents: `#todo [09/15/2025 05:00:00 PM]`
- Result: Appears as “Fix login bug”.

Great for ultra-fast capture—just create a descriptively named file with the hashtag.

## Attachment Management

Timex provides intelligent attachment management for markdown files, making it easy to embed images and other files while maintaining link integrity even when files are moved or renamed.

### How It Works

The extension uses a content-based hashing system to uniquely identify attachments. When you insert an attachment, Timex:
1. Generates a 128-bit SHA-256 hash of the file's contents
2. Renames the file to include the hash: `filename.TIMEX-{hash}.ext`
3. Inserts a properly formatted markdown link at your cursor position

**Example**: An image `screenshot.png` becomes `screenshot.TIMEX-a3f5b2c8d9e1f4a7b6c3d8e2f1a4b7c9.png`

### Inserting Image Attachments

1. Open a markdown file
2. Place cursor where you want the attachment link
3. Right-click → "Timex" submenu → "Insert Image From..." → "Disk"
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

### Inserting File Links

For linking to other markdown files (or any file type) with persistent tracking, use the **"Insert File Link"** feature.

1. Open a markdown file
2. Place cursor where you want the link
3. Right-click → "Timex" submenu → "Insert File Link"
4. Select the target file
5. A link is inserted with a special GUID comment for tracking

**How it works:**
- Checks the target file for an existing `<!-- GUID:<guid> -->` comment
- If missing, generates a new GUID and adds it to the top of the target file
- Inserts a link in your current file with a matching `<!-- TARGET-GUID:<guid> -->` comment
- This GUID pair allows the link to be repaired even if the target file is moved or renamed

**Example inserted link:**
```markdown
<!-- TARGET-GUID:90e08s0f98a0sd0asf0as9f0asf -->
[My Cool File](some/folder/my_cool_file.md)
```

### Insert Image from Clipboard

For rapid image insertion, use the **"Clipboard"** option under the "Insert Image From..." submenu to paste screenshots and images directly into your markdown files.

**How to use:**
1. Copy an image to your system clipboard (e.g., take a screenshot)
2. Open a markdown file and place cursor where you want the image
3. Right-click → "Timex" submenu → "Insert Image From..." → "Clipboard"
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
2. In your markdown file, right-click and select "Timex" → "Insert Image From..." → "Clipboard"
3. Image appears inline immediately: `![img](img.TIMEX-a3f5b2c8.png)`

This feature is perfect for quickly documenting UI issues, capturing error messages, or adding visual context to your notes without the overhead of manually saving and linking image files.

### Fix Broken Links

When you move or reorganize files, links may break. The **"Fix Links"** command automatically repairs them using embedded hash codes (for images) and GUIDs (for file links).

**To use:**
1. Right-click on any file or folder in the Explorer
2. Select "Timex" submenu → "Fix Links"
3. The extension will:
   - Scan the project for TIMEX-formatted attachments and files with GUID comments
   - Find all markdown files with links
   - Detect broken links (files that have moved)
   - Automatically update links to the correct new location

**Smart Behavior:**
- **Comprehensive Scanning**: Processes the entire workspace root and all subdirectories
- **Dual Tracking**: Uses content hash for images and GUID comments for file links
- **Progress Indicator**: Shows scanning and fixing progress
- **Results Report**: Displays number of links fixed and files modified
- **Missing Files Warning**: Lists any targets that couldn't be found

**Example scenario (Image):**
1. You move `screenshot.TIMEX-abc123.png` from `images/` to `assets/screenshots/`
2. Markdown links break: `![screenshot](../images/screenshot.TIMEX-abc123.png)`
3. Run "Fix Links"
4. Links automatically update: `![screenshot](../assets/screenshots/screenshot.TIMEX-abc123.png)`

**Example scenario (File Link):**
1. You move `docs/guide.md` (containing `<!-- GUID:xyz... -->`) to `archive/old-guide.md`
2. Link breaks: `<!-- TARGET-GUID:xyz... --> [Guide](../docs/guide.md)`
3. Run "Fix Links"
4. Link updates: `<!-- TARGET-GUID:xyz... --> [Guide](../archive/old-guide.md)`

### Why Use Content Hashes?

The hash-based naming system provides:
- **Move Resilience**: Links can be repaired even when files move to different folders
- **Rename Resilience**: As long as the hash portion remains, links can be fixed
- **Deduplication**: Same content = same hash, making duplicate detection possible
- **Integrity**: Hash verifies file content hasn't changed

### Best Practices

1. **Always use "Insert Image From..."** instead of manually creating links - this ensures proper hash naming
2. **Run "Fix Attachment Links" after reorganization** - keeps all links working after moving files around
3. **Keep the hash intact** - the `.TIMEX-{hash}` portion is critical for link repair
4. **Rename the descriptive part freely** - you can change `screenshot` to `login-page` as long as `.TIMEX-{hash}` stays

**Supported file types**: Any file can be attached, but images get special treatment with the `!` prefix for inline display.

### Orphan Detection and Management

The "Fix Links" command includes automatic orphan detection. An orphaned attachment is a file with the TIMEX-hash naming convention that is no longer referenced in any markdown file within the project.

**What happens during orphan detection:**
1. The system tracks all attachment references while scanning markdown files across the entire project
2. After fixing broken links, it compares all TIMEX-formatted files against the reference list
3. Any unreferenced attachments are automatically marked as orphans
4. Orphaned files are renamed with an "ORPHAN-" prefix for easy identification

**Example:**
```markdown
# Before deletion of markdown link
![screenshot](my-image.TIMEX-7235fd3525f14bad.png)

# After you delete the link or markdown file
# File automatically renamed to:
ORPHAN-my-image.TIMEX-7235fd3525f14bad.png
```

**Why this is useful:**
- **Easy Cleanup**: Quickly identify which attachments are no longer needed
- **Safe Deletion**: Review orphans before permanently deleting them
- **Reuse Opportunity**: Spot files you might want to use elsewhere
- **Storage Management**: Find unused files consuming disk space

**What to do with orphans:**
- **Delete them** if you're certain they're no longer needed
- **Re-link them** if you realize they should be referenced somewhere
- **Archive them** for potential future use
- **Leave them marked** as orphans if you're unsure

**Progress reporting:** The "Fix Links" command shows how many orphans were found in the completion message, making it easy to monitor unused attachments in your project.

