import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PriorityTag } from './constants';

export class TimexFilterPanel {
    private static currentPanel: TimexFilterPanel | undefined;
    private static cachedCss: string | undefined;
    private static cachedJs: string | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionPath: string,
        private readonly onFilterApplied: (priority: PriorityTag) => void,
        private readonly currentPriority: PriorityTag
    ) {
        this.panel = panel;
        
        try {
            // Load CSS if not already cached
            if (!TimexFilterPanel.cachedCss) {
                TimexFilterPanel.cachedCss = this.loadCss(extensionPath);
            }
            
            // Load JS if not already cached
            if (!TimexFilterPanel.cachedJs) {
                TimexFilterPanel.cachedJs = this.loadJs(extensionPath);
            }
            
            this.panel.webview.html = this.getHtmlContent();
        } catch (error) {
            console.error('[TimexFilterPanel] Error during initialization:', error);
            vscode.window.showErrorMessage(`Failed to initialize filter panel: ${error}`);
            throw error;
        }

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'apply':
                        this.onFilterApplied(message.priority as PriorityTag);
                        this.panel.dispose();
                        break;
                    case 'cancel':
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this.disposables
        );

        // Clean up when panel is closed
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static show(
        extensionUri: vscode.Uri,
        onFilterApplied: (priority: PriorityTag) => void,
        currentPriority: PriorityTag
    ) {        
        try {
            // If we already have a panel, show it
            if (TimexFilterPanel.currentPanel) {
                TimexFilterPanel.currentPanel.panel.reveal();
                return;
            }

            // Create a new panel
            const panel = vscode.window.createWebviewPanel(
                'timexFilterPanel',
                'Timex Filters',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            TimexFilterPanel.currentPanel = new TimexFilterPanel(
                panel,
                extensionUri.fsPath,
                onFilterApplied,
                currentPriority
            );
        } catch (error) {
            console.error('[TimexFilterPanel] Error in show():', error);
            vscode.window.showErrorMessage(`Failed to show filter panel: ${error}`);
            throw error;
        }
    }

    private loadCss(extensionPath: string): string {
        try {
            const cssPath = path.join(extensionPath, 'out', 'filterPanel.css');
            return fs.readFileSync(cssPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanel.css:', error);
            return '/* CSS file not found */';
        }
    }

    private loadJs(extensionPath: string): string {
        try {
            const jsPath = path.join(extensionPath, 'out', 'filterPanelWebview.js');
            return fs.readFileSync(jsPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanelWebview.js:', error);
            return '/* JS file not found */';
        }
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();
        const css = TimexFilterPanel.cachedCss || '';
        const js = TimexFilterPanel.cachedJs || '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Timex Filters</title>
    <style>
        ${css}
    </style>
</head>
<body>
    <div class="filter-section">
        <h2>Priority Filter</h2>
        <div class="radio-group">
            <div class="radio-option">
                <input type="radio" id="priority-any" name="priority" value="${PriorityTag.Any}" ${this.currentPriority === PriorityTag.Any ? 'checked' : ''}>
                <label for="priority-any">Any Priority</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-high" name="priority" value="${PriorityTag.High}" ${this.currentPriority === PriorityTag.High ? 'checked' : ''}>
                <label for="priority-high">Priority 1 (High)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-medium" name="priority" value="${PriorityTag.Medium}" ${this.currentPriority === PriorityTag.Medium ? 'checked' : ''}>
                <label for="priority-medium">Priority 2 (Medium)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-low" name="priority" value="${PriorityTag.Low}" ${this.currentPriority === PriorityTag.Low ? 'checked' : ''}>
                <label for="priority-low">Priority 3 (Low)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-none" name="priority" value="${PriorityTag.None}" ${this.currentPriority === PriorityTag.None ? 'checked' : ''}>
                <label for="priority-none">No Priority</label>
            </div>
        </div>
    </div>

    <div class="button-group">
        <button class="secondary" id="cancelBtn">Cancel</button>
        <button id="applyBtn">OK</button>
    </div>

    <script nonce="${nonce}">
        ${js}
    </script>
</body>
</html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private dispose() {
        TimexFilterPanel.currentPanel = undefined;

        // Clean up resources
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
