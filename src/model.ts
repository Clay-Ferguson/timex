import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { containsAnyConfiguredHashtag, findHashtagsInContent, getAllConfiguredHashtags, getIncludeGlobPattern, getExcludeGlobPattern } from './utils';
import { parseTimestamp, getDaysDifference, isFarFuture as isFarFutureDate, getIconForTaskFile, TIMESTAMP_REGEX } from './pure-utils';
import { ViewFilter, PriorityTag, CompletionFilter } from './constants';

// Constants
export const SCANNING_MESSAGE = 'Scanning workspace';

// Task file container with parsed timestamp for sorting
export class TaskFile {
	constructor(
		public readonly filePath: string,
		public readonly fileName: string,
		public readonly fileUri: vscode.Uri,
		public readonly timestamp: Date,
		public readonly timestampString: string,
		public readonly priority: PriorityTag.High | PriorityTag.Medium | PriorityTag.Low | '',
		public readonly isCompleted: boolean = false,
		public readonly tagsInFile: Set<string> = new Set<string>()
	) { }
}

// Task file item for the tree view
export class TaskFileItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly resourceUri: vscode.Uri,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		// Only set tooltip and description for actual files (not scanning indicator)
		// Check if this is the scanning indicator by looking at the label
		if (this.label.includes(SCANNING_MESSAGE)) {
			// For scanning indicator, just show the label without path info
			this.tooltip = this.label;
			this.description = '';
		} else {
			// For task files, show the full file path in tooltip but clean display name in description
			const fileName = path.basename(resourceUri.fsPath);
			this.tooltip = `${this.label} - ${resourceUri.fsPath}`;
			this.description = ''; // Remove filename display
		}
	}
}

// Tree data provider for task files
export class TaskProvider implements vscode.TreeDataProvider<TaskFileItem> {
	/**
	 * Creates a markdown tooltip for a task item
	 * @param label The task label with icons and formatting
	 * @param timestampString The raw timestamp string from the file
	 * @param filePath The absolute path to the task file
	 * @returns A MarkdownString tooltip
	 */
	private createTaskTooltip(label: string, timestampString: string, filePath: string): vscode.MarkdownString {
		const timestampLine = timestampString.replace(/[\[\]]/g, '');
		const cleaned = label.replace(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]|\S)+\s*(⚠️)?\s*\([^)]*\)\s*/u, '').trim();

		// Calculate relative directory path from workspace root (without filename)
		let relativeDirectory = '';
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
			const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
			if (filePath.startsWith(workspaceRoot)) {
				const relativePath = path.relative(workspaceRoot, filePath);
				// Replace backslashes with forward slashes for consistency across platforms
				const normalizedPath = relativePath.replace(/\\/g, '/');
				// Get just the directory part, not the filename
				relativeDirectory = path.dirname(normalizedPath);
				// If the file is in the root directory, path.dirname returns '.'
				if (relativeDirectory === '.') {
					relativeDirectory = '(root)';
				}
			}
		}

		// Parse the timestamp to get the day of the week
		// parseTimestamp handles both [MM/DD/YYYY] and [MM/DD/YYYY HH:MM:SS AM/PM] formats
		const parsedDate = parseTimestamp(timestampString);
		let dayOfWeek = '';

		if (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate.getFullYear() < 2050) {
			const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			dayOfWeek = days[parsedDate.getDay()];
		}

		const md = new vscode.MarkdownString();
		md.supportHtml = false;
		md.isTrusted = false;

		// Include both timestamp and day of week in the same code block
		// If no day available, show just the timestamp
		const codeContent = dayOfWeek ? `${timestampLine} -- ${dayOfWeek}` : timestampLine;
		md.appendMarkdown(`*\n**${relativeDirectory}**\n\n\`${codeContent}\``);
		return md;
	}

	private _onDidChangeTreeData: vscode.EventEmitter<TaskFileItem | undefined | null | void> = new vscode.EventEmitter<TaskFileItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TaskFileItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private taskFiles: TaskFileItem[] = [];
	private scannedFiles: Set<string> = new Set(); // Track scanned files to prevent duplicates
	private taskFileData: TaskFile[] = []; // Store task files with parsed timestamps
	private currentFilter: ViewFilter = ViewFilter.All; // Track current filter state
	private currentPriorityFilter: PriorityTag = PriorityTag.Any; // Track current priority filter
	private currentSearchQuery: string = ''; // Track current search query
	private completionFilter: CompletionFilter = CompletionFilter.Any; // Track completion filter
	private treeView: vscode.TreeView<TaskFileItem> | null = null;
	private isScanning: boolean = false; // Track scanning state
	private cachedPrimaryHashtag: string | null = null; // Cache for primary hashtag
	private currentPrimaryHashtag: string | null = null; // Runtime override for primary hashtag
	private context: vscode.ExtensionContext;
	private cutIndicator: string | null = null; // Track ordinal cut indicator message
	private pendingRevealPath: string | null = null; // File path queued for reveal after refresh

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.loadFilterState();
	}

	/**
	 * Load filter state from workspace storage
	 */
	private loadFilterState(): void {
		const savedFilter = this.context.workspaceState.get<ViewFilter>('timex.currentFilter');
		const savedPriorityFilter = this.context.workspaceState.get<PriorityTag>('timex.currentPriorityFilter');
		const savedCompletionFilter = this.context.workspaceState.get<CompletionFilter>('timex.completionFilter');
		const savedPrimaryHashtag = this.context.workspaceState.get<string>('timex.currentPrimaryHashtag');

		if (savedFilter !== undefined) {
			this.currentFilter = savedFilter;
		}
		if (savedPriorityFilter !== undefined) {
			this.currentPriorityFilter = savedPriorityFilter;
		}
		if (savedCompletionFilter !== undefined) {
			this.completionFilter = savedCompletionFilter;
		}
		if (savedPrimaryHashtag !== undefined) {
			this.currentPrimaryHashtag = savedPrimaryHashtag;
		}
	}

	/**
	 * Save filter state to workspace storage
	 */
	private saveFilterState(): void {
		this.context.workspaceState.update('timex.currentFilter', this.currentFilter);
		this.context.workspaceState.update('timex.currentPriorityFilter', this.currentPriorityFilter);
		this.context.workspaceState.update('timex.completionFilter', this.completionFilter);
		this.context.workspaceState.update('timex.currentPrimaryHashtag', this.currentPrimaryHashtag);
	}

	/**
	 * Detects the priority level from file content
	 * @param content The file content to analyze
	 * @returns The priority level (PriorityTag.High/Medium/Low, or '' for no priority tag)
	 */
	private detectPriorityFromContent(content: string): PriorityTag.High | PriorityTag.Medium | PriorityTag.Low | '' {
		if (content.includes(`#${PriorityTag.High}`)) {
			return PriorityTag.High;
		} else if (content.includes(`#${PriorityTag.Medium}`)) {
			return PriorityTag.Medium;
		} else if (content.includes(`#${PriorityTag.Low}`)) {
			return PriorityTag.Low;
		}
		// No priority tag found - return empty string so white circle is shown
		return '';
	}

	/**
	 * Gets the current primary hashtag from runtime override or VSCode workspace configuration
	 * @returns The primary hashtag string (e.g., "#todo") or "all-tags" for no filtering
	 */
	getPrimaryHashtag(): string {
		// Check runtime override first
		if (this.currentPrimaryHashtag !== null) {
			return this.currentPrimaryHashtag;
		}

		// Fall back to cached configuration
		if (this.cachedPrimaryHashtag === null) {
			const config = vscode.workspace.getConfiguration('timex');
			this.cachedPrimaryHashtag = config.get<string>('primaryHashtag', '#todo');
		}
		return this.cachedPrimaryHashtag;
	}

	/**
	 * Clears the cached primary hashtag to force reload from configuration
	 * Call this when the configuration changes
	 */
	clearPrimaryHashtagCache(): void {
		this.cachedPrimaryHashtag = null;
	}

	/**
	 * Sets the runtime override for primary hashtag
	 * @param hashtag The hashtag to override with, or null to clear override
	 */
	setPrimaryHashtagOverride(hashtag: string | null): void {
		this.currentPrimaryHashtag = hashtag;
		this.saveFilterState();
	}

	setTreeView(treeView: vscode.TreeView<TaskFileItem>): void {
		this.treeView = treeView;
		this.updateTreeViewTitle(); // Set initial title
		this.updateTreeViewMessage();
	}

	queueReveal(filePath: string): void {
		this.pendingRevealPath = filePath;
	}

	private scheduleReveal(): void {
		if (!this.pendingRevealPath || !this.treeView) {
			return;
		}

		setTimeout(() => {
			void this.revealPendingTaskIfNeeded();
		}, 50);
	}

	setCutIndicator(displayName: string | null): void {
		this.cutIndicator = displayName;
		this.updateTreeViewMessage();
	}

	clearCutIndicator(): void {
		this.cutIndicator = null;
		this.updateTreeViewMessage();
	}

	// Getter methods for current filter states
	getCurrentPriorityFilter(): PriorityTag {
		return this.currentPriorityFilter;
	}

	getCurrentViewFilter(): ViewFilter {
		return this.currentFilter;
	}

	getCompletionFilter(): CompletionFilter {
		return this.completionFilter;
	}

	/**
	 * Updates a single task item after its timestamp has been modified
	 * This is more efficient than a full refresh for single item updates
	 * @param filePath The absolute path of the file that was updated
	 * @param newTimestampString The new timestamp string in the file
	 */
	async updateSingleTask(filePath: string, newTimestampString: string): Promise<void> {
		try {
			// Find the task in our data
			const taskIndex = this.taskFileData.findIndex(task => task.filePath === filePath);
			if (taskIndex === -1) {
				// Task not found, fall back to full refresh
				this.refresh();
				return;
			}

			// Parse the new timestamp
			const newTimestamp = parseTimestamp(newTimestampString);
			if (!newTimestamp) {
				// Failed to parse, fall back to full refresh
				this.refresh();
				return;
			}

			// Re-read the file to get updated priority and content
			const content = fs.readFileSync(filePath, 'utf8');
			const priority = this.detectPriorityFromContent(content);

			// Update the task data
			const oldTask = this.taskFileData[taskIndex];
			const isCompleted = content.includes('#done');
			// Find hashtags in the updated content
			const tagsInFile = findHashtagsInContent(content);
			const updatedTask = new TaskFile(
				oldTask.filePath,
				oldTask.fileName,
				oldTask.fileUri,
				newTimestamp,
				newTimestampString,
				priority,
				isCompleted,
				tagsInFile
			);
			this.taskFileData[taskIndex] = updatedTask;

			// Re-build the task files display (similar to scanForTaskFiles but without scanning)
			await this.applyFiltersToExistingData();

			// Fire the tree data change event
			this._onDidChangeTreeData.fire();

			// Highlight the updated item
			await this.highlightUpdatedTask(filePath);

		} catch (error) {
			console.error('Error updating single task:', error);
			// Fall back to full refresh on error
			this.refresh();
		}
	}

	/**
	 * Highlights and selects the specified task item in the tree view
	 * @param filePath The absolute path of the file to highlight
	 */
	private async highlightUpdatedTask(filePath: string): Promise<void> {
		if (!this.treeView) {
			return;
		}

		try {
			const updatedTreeItem = this.taskFiles.find(item =>
				item.resourceUri.fsPath === filePath
			);

			if (updatedTreeItem) {
				// Reveal and select the updated item
				await this.treeView.reveal(updatedTreeItem, {
					select: true,
					focus: false,
					expand: false
				});
			}
		} catch (error) {
			console.error('Error highlighting updated task:', error);
			// Don't throw - this is just a UX enhancement
		}
	}

	refresh(): void {
		this.currentFilter = ViewFilter.All;
		this.currentSearchQuery = ''; // Clear search when refreshing
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	refreshDueSoon(): void {
		this.currentFilter = ViewFilter.DueSoon;
		this.currentSearchQuery = ''; // Clear search when switching filters
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles(true).then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	refreshDueToday(): void {
		this.currentFilter = ViewFilter.DueToday;
		this.currentSearchQuery = ''; // Clear search when switching filters
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles(false, false, true).then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	refreshFutureDueDates(): void {
		this.currentFilter = ViewFilter.FutureDueDates;
		this.currentSearchQuery = ''; // Clear search when switching filters
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles(false, false, false, true).then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	refreshOverdue(): void {
		this.currentFilter = ViewFilter.Overdue;
		this.currentSearchQuery = ''; // Clear search when switching filters
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles(false, true).then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	filterByPriority(priorityFilter: PriorityTag): void {
		this.currentPriorityFilter = priorityFilter;
		this.currentSearchQuery = ''; // Clear search when changing priority filter
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	setCompletionFilter(filter: CompletionFilter): void {
		this.completionFilter = filter;
		this.currentSearchQuery = ''; // Clear search when changing completed filter
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	searchTasks(query: string): void {
		this.currentSearchQuery = query.toLowerCase();
		this.currentFilter = ViewFilter.Search;
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.applyFiltersToExistingData().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	clearSearch(): void {
		this.currentSearchQuery = '';
		if (this.currentFilter === ViewFilter.Search) {
			this.currentFilter = ViewFilter.All;
		}
		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.applyFiltersToExistingData().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	clearFilters(): void {
		// Reset all filters to their default "all" states
		this.currentPriorityFilter = PriorityTag.Any;
		this.currentFilter = ViewFilter.All;
		this.completionFilter = CompletionFilter.Any;
		this.currentSearchQuery = '';
		this.currentPrimaryHashtag = 'all-tags';

		this.saveFilterState();
		this.updateTreeViewTitle();
		this.showScanningIndicator();
		this.scanForTaskFiles().then(() => {
			this.hideScanningIndicator();
			this._onDidChangeTreeData.fire();
			this.scheduleReveal();
		});
	}

	private showScanningIndicator(): void {
		this.isScanning = true;
		this._onDidChangeTreeData.fire();
	}

	private hideScanningIndicator(): void {
		this.isScanning = false;
	}

	private updateTreeViewTitle(): void {
		if (this.treeView) {
			const titleParts: string[] = [];

			// 1. Tag selection: Always show the primary hashtag (this is the base filter)
			const primaryHashtag = this.getPrimaryHashtag();
			const hashtagDisplay = primaryHashtag === 'all-tags' ? '' : primaryHashtag;
			if (hashtagDisplay) {
				titleParts.push(hashtagDisplay);
			}

			// 2. Priority: Only show if not 'all' (the default/no-filtering state)
			if (this.currentPriorityFilter !== PriorityTag.Any) {
				const priorityDisplay = this.currentPriorityFilter.toUpperCase();
				titleParts.push(priorityDisplay);
			}

			// 3. Time range: Only show if not 'All' (the default/no-filtering state)
			if (this.currentFilter !== ViewFilter.All) {
				titleParts.push(this.currentFilter.toUpperCase());
			}

			// 4. Completion status: Only show if not 'not-completed' (the default state)			
			let completionDisplay = '';
			if (this.completionFilter === CompletionFilter.Any) {
				// leave blank
			} else if (this.completionFilter === CompletionFilter.Completed) {
				completionDisplay = 'DONE';
			}
			else {
				completionDisplay = 'NOT DONE';
			}
			if (completionDisplay) {
				titleParts.push(completionDisplay);
			}

			// 5. Search query: Only show if there's an active search
			if (this.currentSearchQuery) {
				titleParts.push(`"${this.currentSearchQuery}"`);
			}

			// Join all parts with ' - ' separator, filter out any empty strings just to be safe
			const filteredParts = titleParts.filter(part => part.trim().length > 0);
			if (filteredParts.length > 0) {
				this.treeView.title = filteredParts.join(' - ');
			}
			else {
				this.treeView.title = '';
			}
			console.log(`Updated tree view title [${this.treeView.title}]`);
		}
	}

	private updateTreeViewMessage(): void {
		if (!this.treeView) {
			return;
		}

		if (this.cutIndicator && this.cutIndicator.trim().length > 0) {
			this.treeView.message = `✂️ Cut: ${this.cutIndicator}`;
		} else {
			this.treeView.message = undefined;
		}
	}

	/**
	 * Applies current filters to existing taskFileData without rescanning
	 * Used for search and other operations that don't need a full workspace scan
	 */
	private async applyFiltersToExistingData(): Promise<void> {
		// Apply date/time filters first
		let filteredTaskData = this.taskFileData;
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		if (this.currentFilter === ViewFilter.DueSoon) {
			const threeDaysFromNow = new Date();
			threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
			threeDaysFromNow.setHours(23, 59, 59, 999);

			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= today && taskFile.timestamp <= threeDaysFromNow
			);
		} else if (this.currentFilter === ViewFilter.DueToday) {
			// Filter by due today only
			const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= today && taskFile.timestamp <= endOfToday
			);
		} else if (this.currentFilter === ViewFilter.FutureDueDates) {
			// Filter by future due dates only (after today)
			const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= tomorrowStart
			);
		} else if (this.currentFilter === ViewFilter.Overdue) {
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp < today
			);
		}

		// Apply priority filter if not "all"
		if (this.currentPriorityFilter !== PriorityTag.Any) {
			filteredTaskData = filteredTaskData.filter(taskFile =>
				taskFile.priority === this.currentPriorityFilter
			);
		}

		// Apply search filter if there's a search query
		if (this.currentSearchQuery) {
			filteredTaskData = await this.filterTasksBySearch(filteredTaskData, this.currentSearchQuery);
		}

		// Sort task files by timestamp (chronological order)
		filteredTaskData.sort((a, b) => {
			return a.timestamp.getTime() - b.timestamp.getTime();
		});

		// Create tree items from filtered task files
		this.taskFiles = filteredTaskData.map(taskFile => {
			const daysDiff = getDaysDifference(taskFile.timestamp);
			const isOverdue = taskFile.timestamp < today;
			const isFarFuture = isFarFutureDate(taskFile.timestamp);
			const isTodo = taskFile.tagsInFile.has('#todo');

			const icon = getIconForTaskFile(taskFile);

			const displayText = taskFile.fileName;
			// Show days difference in parentheses at the beginning of the task description
			// For overdue items, show warning icon immediately after priority icon
			let label = isOverdue && isTodo
				? `${icon}⚠️ (${daysDiff}) ${displayText}`
				: `${icon} (${daysDiff}) ${displayText}`;

			const treeItem = new TaskFileItem(
				label,
				taskFile.fileUri,
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'vscode.open',
					title: 'Open File',
					arguments: [taskFile.fileUri]
				}
			);

			// Create markdown tooltip
			treeItem.tooltip = this.createTaskTooltip(label, taskFile.timestampString, taskFile.filePath);

			// Set context value based on timestamp presence and far future status
			// Check if task has a real timestamp (not the default 2050 one)
			const hasRealTimestamp = taskFile.timestamp.getFullYear() < 2050;

			if (isFarFuture && !hasRealTimestamp) {
				treeItem.contextValue = 'farFutureTask';
			} else if (hasRealTimestamp) {
				treeItem.contextValue = 'taskWithTimestamp';
			} else {
				treeItem.contextValue = 'taskWithoutTimestamp';
			}

			return treeItem;
		});

		// Update context to show/hide the tree view
		vscode.commands.executeCommand('setContext', 'workspaceHasTaskFiles', this.taskFiles.length > 0);
	}

	/**
	 * Filters task files by search query, checking both filename and file content
	 */
	private async filterTasksBySearch(taskFiles: TaskFile[], searchQuery: string): Promise<TaskFile[]> {
		const results: TaskFile[] = [];

		for (const taskFile of taskFiles) {
			try {
				// Check if filename contains search query
				const fileNameMatch = taskFile.fileName.toLowerCase().includes(searchQuery);

				// Check if file content contains search query
				const content = await fs.promises.readFile(taskFile.filePath, 'utf8');
				const contentMatch = content.toLowerCase().includes(searchQuery);

				if (fileNameMatch || contentMatch) {
					results.push(taskFile);
				}
			} catch (error) {
				console.error(`Error reading file during search: ${taskFile.filePath}`, error);
				// If we can't read the file, include it if filename matches
				if (taskFile.fileName.toLowerCase().includes(searchQuery)) {
					results.push(taskFile);
				}
			}
		}

		return results;
	}

	getTreeItem(element: TaskFileItem): vscode.TreeItem {
		return element;
	}

	getParent(element: TaskFileItem): vscode.ProviderResult<TaskFileItem> {
		// Since our tree is flat (no hierarchy), all items have no parent
		return null;
	}

	getChildren(element?: TaskFileItem): Thenable<TaskFileItem[]> {
		if (!element) {
			// Return root level items (all task files or scanning indicator)
			if (this.isScanning) {
				return Promise.resolve([
					new TaskFileItem(
						`⏳ ${SCANNING_MESSAGE}...`,
						vscode.Uri.file(''),
						vscode.TreeItemCollapsibleState.None
					)
				]);
			}
			return Promise.resolve(this.taskFiles);
		}
		return Promise.resolve([]);
	}

	private async scanForTaskFiles(dueSoonOnly: boolean = false, overdueOnly: boolean = false, dueTodayOnly: boolean = false, futureDueDatesOnly: boolean = false): Promise<void> {
		this.taskFiles = [];
		this.taskFileData = [];
		this.scannedFiles.clear(); // Clear the set of scanned files

		if (!vscode.workspace.workspaceFolders) {
			return;
		}

		// Use VS Code's efficient file search API instead of manual directory traversal
		await this.scanMarkdownFilesOptimized();

		// Filter by due soon or overdue if requested
		let filteredTaskData = this.taskFileData;
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		if (dueSoonOnly) {
			// Filter by due soon (within 3 days, excluding overdue)
			const threeDaysFromNow = new Date();
			threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
			threeDaysFromNow.setHours(23, 59, 59, 999); // End of the day

			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= today && taskFile.timestamp <= threeDaysFromNow
			);
		} else if (dueTodayOnly) {
			// Filter by due today only
			const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= today && taskFile.timestamp <= endOfToday
			);
		} else if (futureDueDatesOnly) {
			// Filter by future due dates only (after today)
			const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp >= tomorrowStart
			);
		} else if (overdueOnly) {
			// Filter by overdue only (past due date, excluding today)
			filteredTaskData = this.taskFileData.filter(taskFile =>
				taskFile.timestamp < today
			);
		}

		// Apply priority filter if not "all"
		if (this.currentPriorityFilter !== PriorityTag.Any) {
			filteredTaskData = filteredTaskData.filter(taskFile =>
				taskFile.priority === this.currentPriorityFilter
			);
		}

		// Sort task files by timestamp (chronological order)
		filteredTaskData.sort((a, b) => {
			return a.timestamp.getTime() - b.timestamp.getTime();
		});

		// Create tree items from sorted task files
		this.taskFiles = filteredTaskData.map(taskFile => {
			const daysDiff = getDaysDifference(taskFile.timestamp);
			const isOverdue = taskFile.timestamp < today;
			const isFarFuture = isFarFutureDate(taskFile.timestamp);
			const isTodo = taskFile.tagsInFile.has('#todo'); 

			const icon = getIconForTaskFile(taskFile);

			const displayText = taskFile.fileName;
			// Show days difference in parentheses at the beginning of the task description
			// For overdue items, show warning icon immediately after priority icon
			let label = isOverdue && isTodo
				? `${icon}⚠️ (${daysDiff}) ${displayText}`
				: `${icon} (${daysDiff}) ${displayText}`;

			const treeItem = new TaskFileItem(
				label,
				taskFile.fileUri,
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'vscode.open',
					title: 'Open File',
					arguments: [taskFile.fileUri]
				}
			);

			// Create markdown tooltip
			treeItem.tooltip = this.createTaskTooltip(label, taskFile.timestampString, taskFile.filePath);

			// Set context value based on timestamp presence and far future status
			// Check if task has a real timestamp (not the default 2050 one)
			const hasRealTimestamp = taskFile.timestamp.getFullYear() < 2050;

			if (isFarFuture && !hasRealTimestamp) {
				treeItem.contextValue = 'farFutureTask';
			} else if (hasRealTimestamp) {
				treeItem.contextValue = 'taskWithTimestamp';
			} else {
				treeItem.contextValue = 'taskWithoutTimestamp';
			}

			return treeItem;
		});

		// Update context to show/hide the tree view
		vscode.commands.executeCommand('setContext', 'workspaceHasTaskFiles', this.taskFiles.length > 0);
	}

	private async revealPendingTaskIfNeeded(): Promise<void> {
		if (!this.pendingRevealPath || !this.treeView) {
			return;
		}

		const targetPath = this.pendingRevealPath;
		const item = this.taskFiles.find(task => task.resourceUri.fsPath === targetPath);
		if (!item) {
			this.scheduleReveal();
			return;
		}

		this.pendingRevealPath = null;

		try {
			await this.treeView.reveal(item, {
				select: true,
				focus: false,
				expand: false
			});
		} catch (error) {
			console.error('Failed to reveal task after refresh:', error);
		}
	}

	/**
	 * Optimized scanning using VS Code's findFiles API to get only .md files upfront
	 */
	private async scanMarkdownFilesOptimized(): Promise<void> {
		// Use VS Code's built-in file search with glob pattern
		// This excludes common directories automatically and is much faster
		const includePattern = getIncludeGlobPattern();
		const excludePattern = getExcludeGlobPattern();

		const mdFiles = await vscode.workspace.findFiles(
			includePattern,
			excludePattern, // Exclude configured directories
			undefined // No max results limit
		);

		// Process each markdown file
		for (const fileUri of mdFiles) {
			const filePath = fileUri.fsPath;
			const fileName = path.basename(filePath);

			// Apply the same file filtering logic
			if (!this.isTaskFile(fileName)) {
				continue;
			}

			await this.scanFile(filePath);
		}
	}

	// This currently-unused method is kept as fallback. But was replaced with the more efficient
	// scanMarkdownFilesOptimized method.
	private async scanDirectory(dirPath: string): Promise<void> {
		try {
			const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);

				// Skip node_modules, .git, and other common directories we don't want to scan
				if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
					await this.scanDirectory(fullPath);
				} else if (entry.isFile() && this.isTaskFile(entry.name)) {
					await this.scanFile(fullPath);
				}
			}
		} catch (error) {
			console.error(`Error scanning directory ${dirPath}:`, error);
		}
	}

	private shouldSkipDirectory(dirName: string): boolean {
		const skipDirs = ['node_modules', '.git', '.vscode', 'out', 'dist', 'build', '.next', 'target'];
		return skipDirs.includes(dirName) || dirName.startsWith('.');
	}

	private isTaskFile(fileName: string): boolean {
		const lowerFileName = fileName.toLowerCase();
		// Ignore files starting with underscore or period
		if (fileName.startsWith('_') || fileName.startsWith('.')) {
			return false;
		}
		return lowerFileName.endsWith('.md');
	}

	private async scanFile(filePath: string): Promise<void> {
		try {
			// Prevent duplicate scanning of the same file
			if (this.scannedFiles.has(filePath)) {
				return;
			}
			this.scannedFiles.add(filePath);

			// Quick hashtag check first - read only first 1KB to check for hashtags
			// This avoids reading large files that don't contain task hashtags
			const quickHashtag = this.getPrimaryHashtag();
			let foundQuickHashtag = false;

			if (quickHashtag === 'all-tags') {
				// Need to check for any configured hashtag
				const allHashtags = getAllConfiguredHashtags();
				const quickBuffer = Buffer.alloc(1024);
				const fd = await fs.promises.open(filePath, 'r');
				try {
					const { bytesRead } = await fd.read(quickBuffer, 0, 1024, 0);
					const quickContent = quickBuffer.slice(0, bytesRead).toString('utf8');
					foundQuickHashtag = allHashtags.some((hashtag: string) => quickContent.includes(hashtag));
				} finally {
					await fd.close();
				}
			} else {
				// Just check for the primary hashtag
				const quickBuffer = Buffer.alloc(1024);
				const fd = await fs.promises.open(filePath, 'r');
				try {
					const { bytesRead } = await fd.read(quickBuffer, 0, 1024, 0);
					const quickContent = quickBuffer.slice(0, bytesRead).toString('utf8');
					foundQuickHashtag = quickContent.includes(quickHashtag);
				} finally {
					await fd.close();
				}
			}

			// If no hashtag found in first 1KB, skip this file entirely
			if (!foundQuickHashtag) {
				return;
			}

			// Only read the full file if we found a hashtag in the preview
			const content = await fs.promises.readFile(filePath, 'utf8');

			// Check for primary hashtag or any hashtag if in 'all-tags' mode
			const primaryHashtag = this.getPrimaryHashtag();
			const hasTaskHashtag = primaryHashtag === 'all-tags'
				? containsAnyConfiguredHashtag(content)
				: content.includes(primaryHashtag);

			const isDoneTask = content.includes('#done');			// Include files based on completion filter
			let includeTask = false;
			if (hasTaskHashtag) {
				if (this.completionFilter === CompletionFilter.Any) {
					includeTask = true;
				} else if (this.completionFilter === CompletionFilter.Completed) {
					includeTask = isDoneTask;
				} else if (this.completionFilter === CompletionFilter.NotCompleted) {
					includeTask = !isDoneTask;
				}
			}

			if (includeTask) {
				// Look for timestamp, but it's optional now
				// Only support the new standard format: [MM/DD/YYYY] or [MM/DD/YYYY HH:MM:SS AM/PM]
				const timestampRegex = TIMESTAMP_REGEX;
				const timestampMatch = content.match(timestampRegex);

				let parsedTimestamp: Date;
				let timestampString: string;

				if (timestampMatch) {
					// Use existing timestamp if found (keep original string for display)
					timestampString = timestampMatch[0];
					const parsed = parseTimestamp(timestampString);
					parsedTimestamp = parsed || new Date(2050, 0, 1, 12, 0, 0);
				} else {
					// No timestamp found, use January 1st, 2050 as default (far future)
					parsedTimestamp = new Date(2050, 0, 1, 12, 0, 0);
					// Emit placeholder in new standard format
					timestampString = `[01/01/2050 12:00:00 PM]`;
				}

				// Detect priority
				const priority = this.detectPriorityFromContent(content);

				// Check if task is completed
				const isCompleted = isDoneTask;

				const fileName = path.basename(filePath);
				const fileUri = vscode.Uri.file(filePath);

				// Find hashtags in the file content
				const tagsInFile = findHashtagsInContent(content);

				const taskFile = new TaskFile(
					filePath,
					fileName,
					fileUri,
					parsedTimestamp,
					timestampString,
					priority,
					isCompleted,
					tagsInFile
				);
				this.taskFileData.push(taskFile);
			}
		} catch (error) {
			console.error(`Error scanning file ${filePath}:`, error);
		}
	}
}
