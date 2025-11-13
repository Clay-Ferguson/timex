// Timex Filter Panel JavaScript
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
