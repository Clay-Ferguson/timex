import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Tree item representing a file or folder in the markdown explorer
 */
export class MarkdownExplorerItem extends vscode.TreeItem {
	constructor(
		public readonly resourceUri: vscode.Uri,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly isDirectory: boolean
	) {
		super(resourceUri, collapsibleState);
		
		this.tooltip = resourceUri.fsPath;
		
		if (isDirectory) {
			this.contextValue = 'folder';
			this.iconPath = vscode.ThemeIcon.Folder;
		} else {
			this.contextValue = 'file';
			// Use default file icon - VS Code will pick appropriate icon based on file type
			this.iconPath = vscode.ThemeIcon.File;
			
			// For markdown files, open in preview mode
			// For images and other files, open normally
			const ext = path.extname(resourceUri.fsPath).toLowerCase();
			if (ext === '.md') {
				this.command = {
					command: 'timex.openMarkdownPreview',
					title: 'Open Preview',
					arguments: [resourceUri]
				};
			} else {
				// For images and other files, open normally
				this.command = {
					command: 'vscode.open',
					title: 'Open File',
					arguments: [resourceUri]
				};
			}
		}
	}
}

/**
 * Image file extensions to include in the explorer
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif']);

/**
 * Tree data provider for the markdown explorer view
 * Shows markdown files and images, opens markdown files in preview mode
 */
export class MarkdownExplorerProvider implements vscode.TreeDataProvider<MarkdownExplorerItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<MarkdownExplorerItem | undefined | null | void> = 
		new vscode.EventEmitter<MarkdownExplorerItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MarkdownExplorerItem | undefined | null | void> = 
		this._onDidChangeTreeData.event;

	private excludePatterns: string[] = [
		'node_modules',
		'.git',
		'.vscode',
		'out',
		'dist',
		'build',
		'.next',
		'target',
		'.DS_Store'
	];

	constructor() {
		// Load exclude patterns from configuration
		this.loadExcludePatterns();
	}

	private loadExcludePatterns(): void {
		const config = vscode.workspace.getConfiguration('timex');
		const excludeGlobs = config.get<string[]>('excludeGlobs', []);
		
		// Extract folder names from glob patterns
		this.excludePatterns = excludeGlobs.map(glob => {
			// Extract the folder name from patterns like "**/node_modules/**"
			const match = glob.match(/\*\*\/([^/*]+)\/?\*?\*?/);
			return match ? match[1] : glob;
		}).filter(pattern => pattern.length > 0);
		
		// Add common patterns that should always be excluded
		const alwaysExclude = ['node_modules', '.git', '.DS_Store'];
		for (const pattern of alwaysExclude) {
			if (!this.excludePatterns.includes(pattern)) {
				this.excludePatterns.push(pattern);
			}
		}
	}

	refresh(): void {
		this.loadExcludePatterns();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: MarkdownExplorerItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: MarkdownExplorerItem): Promise<MarkdownExplorerItem[]> {
		if (!vscode.workspace.workspaceFolders) {
			return [];
		}

		let dirPath: string;
		
		if (!element) {
			// Root level - use workspace folder
			dirPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
		} else {
			// Child level - use element's path
			dirPath = element.resourceUri.fsPath;
		}

		return this.getFilesAndFolders(dirPath);
	}

	private async getFilesAndFolders(dirPath: string): Promise<MarkdownExplorerItem[]> {
		const items: MarkdownExplorerItem[] = [];
		
		try {
			const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
			
			// Separate folders and files for sorting
			const folders: MarkdownExplorerItem[] = [];
			const files: MarkdownExplorerItem[] = [];
			
			for (const entry of entries) {
				// Skip hidden files and excluded patterns
				if (entry.name.startsWith('.') || this.shouldExclude(entry.name)) {
					continue;
				}
				
				const fullPath = path.join(dirPath, entry.name);
				const uri = vscode.Uri.file(fullPath);
				
				if (entry.isDirectory()) {
					// Check if directory contains any markdown or image files (recursively)
					const hasRelevantFiles = await this.containsRelevantFiles(fullPath);
					if (hasRelevantFiles) {
						folders.push(new MarkdownExplorerItem(
							uri,
							vscode.TreeItemCollapsibleState.Collapsed,
							true
						));
					}
				} else {
					// Only show markdown files and images
					const ext = path.extname(entry.name).toLowerCase();
					if (ext === '.md' || IMAGE_EXTENSIONS.has(ext)) {
						files.push(new MarkdownExplorerItem(
							uri,
							vscode.TreeItemCollapsibleState.None,
							false
						));
					}
				}
			}
			
			// Sort folders and files alphabetically
			folders.sort((a, b) => 
				path.basename(a.resourceUri.fsPath).localeCompare(path.basename(b.resourceUri.fsPath))
			);
			files.sort((a, b) => 
				path.basename(a.resourceUri.fsPath).localeCompare(path.basename(b.resourceUri.fsPath))
			);
			
			// Return folders first, then files
			items.push(...folders, ...files);
			
		} catch (error) {
			console.error('Error reading directory:', error);
		}
		
		return items;
	}

	private shouldExclude(name: string): boolean {
		return this.excludePatterns.some(pattern => {
			// Simple name matching
			if (name === pattern) {
				return true;
			}
			// Check if it starts with the pattern (for hidden files)
			if (pattern.startsWith('.') && name.startsWith(pattern)) {
				return true;
			}
			return false;
		});
	}

	/**
	 * Recursively check if a directory contains any markdown or image files
	 */
	private async containsRelevantFiles(dirPath: string): Promise<boolean> {
		try {
			const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
			
			for (const entry of entries) {
				// Skip excluded patterns
				if (entry.name.startsWith('.') || this.shouldExclude(entry.name)) {
					continue;
				}
				
				const fullPath = path.join(dirPath, entry.name);
				
				if (entry.isDirectory()) {
					// Recursively check subdirectory
					const hasRelevantFiles = await this.containsRelevantFiles(fullPath);
					if (hasRelevantFiles) {
						return true;
					}
				} else {
					// Check if file is markdown or image
					const ext = path.extname(entry.name).toLowerCase();
					if (ext === '.md' || IMAGE_EXTENSIONS.has(ext)) {
						return true;
					}
				}
			}
		} catch (error) {
			console.error('Error checking for relevant files:', error);
		}
		
		return false;
	}
}

/**
 * Opens a markdown file in preview mode only
 */
export async function openMarkdownPreview(uri: vscode.Uri): Promise<void> {
	try {
		// Use the markdown.showPreview command to open preview
		// This opens the preview without opening the source file
		await vscode.commands.executeCommand('markdown.showPreview', uri);
	} catch (error) {
		console.error('Error opening markdown preview:', error);
		vscode.window.showErrorMessage(`Failed to open preview: ${error}`);
	}
}
