import * as vscode from 'vscode';

/**
 * todo-0: WARNING: This code is dupliated in multiple projects not in the same repo.
 *  
 * Helper to rename files using VS Code API, accepting string paths.
 *
 * Uses WorkspaceEdit to ensure open editors are updated with the new filename. This is IMPORTANT to keep the open editors
 * from getting confused about what file is being edited when a rename happens while the file is open in the editor.
 */
export async function ws_rename(oldPath: string, newPath: string, options: { overwrite: boolean; } = { overwrite: false }): Promise<void> {
	const oldUri = vscode.Uri.file(oldPath);
	const newUri = vscode.Uri.file(newPath);

	const edit = new vscode.WorkspaceEdit();
	edit.renameFile(oldUri, newUri, options);

	const success = await vscode.workspace.applyEdit(edit);
	if (!success) {
		throw new Error(`Failed to rename ${oldPath} to ${newPath}`);
	}
}

/**
 * Helper to read file content using VS Code API.
 */
export async function ws_read_file(filePath: string): Promise<string> {
	const uri = vscode.Uri.file(filePath);
	const uint8Array = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder().decode(uint8Array);
}

/**
 * Helper to write file content using VS Code API.
 */
export async function ws_write_file(filePath: string, content: string | Uint8Array): Promise<void> {
	const uri = vscode.Uri.file(filePath);
	const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	await vscode.workspace.fs.writeFile(uri, data);
}

/**
 * Helper to delete a file or directory using VS Code API.
 */
export async function ws_delete(filePath: string, options: { recursive: boolean; useTrash: boolean; } = { recursive: false, useTrash: false }): Promise<void> {
	const uri = vscode.Uri.file(filePath);
	await vscode.workspace.fs.delete(uri, options);
}

/**
 * Helper to create a directory using VS Code API.
 */
export async function ws_mkdir(dirPath: string): Promise<void> {
	const uri = vscode.Uri.file(dirPath);
	await vscode.workspace.fs.createDirectory(uri);
}

/**
 * Helper to get file stats using VS Code API.
 */
export async function ws_stat(filePath: string): Promise<vscode.FileStat> {
	const uri = vscode.Uri.file(filePath);
	return await vscode.workspace.fs.stat(uri);
}

/**
 * Helper to check if a file exists using VS Code API.
 */
export async function ws_exists(filePath: string): Promise<boolean> {
	try {
		await ws_stat(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Helper to read directory contents using VS Code API.
 */
export async function ws_read_directory(dirPath: string): Promise<[string, vscode.FileType][]> {
	const uri = vscode.Uri.file(dirPath);
	return await vscode.workspace.fs.readDirectory(uri);
}

