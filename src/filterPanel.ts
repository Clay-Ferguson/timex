import * as vscode from 'vscode';
import { PriorityTag } from './constants';

export class TimexFilterPanel {
    private static currentPanel: TimexFilterPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly onFilterApplied: (priority: PriorityTag) => void,
        private readonly currentPriority: PriorityTag
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtmlContent();

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
            onFilterApplied,
            currentPriority
        );
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Timex Filters</title>
    <style>
        body {
            padding: 20px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        
        .filter-section {
            margin-bottom: 30px;
        }
        
        .filter-section h2 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }
        
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            padding: 4px;
        }
        
        .radio-option:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .radio-option input[type="radio"] {
            cursor: pointer;
            margin: 0;
        }
        
        .radio-option label {
            cursor: pointer;
            flex: 1;
        }
        
        .button-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        button {
            padding: 6px 14px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            font-size: 13px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
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
        const vscode = acquireVsCodeApi();

        document.getElementById('applyBtn').addEventListener('click', () => {
            const selectedPriority = document.querySelector('input[name="priority"]:checked').value;
            vscode.postMessage({
                command: 'apply',
                priority: selectedPriority
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        // Allow Enter key to submit
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('applyBtn').click();
            } else if (e.key === 'Escape') {
                document.getElementById('cancelBtn').click();
            }
        });
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
