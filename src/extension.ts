import * as vscode from 'vscode';
import * as path from 'path';
import { AnyRAGServer } from './anyragServer.js';
import { LicenseManager } from './licenseManager.js';
import { MCPClient, IndexSource } from './mcpClient.js';

let anyragServer: AnyRAGServer;
let licenseManager: LicenseManager;
let mcpClient: MCPClient;
let statusBarItem: vscode.StatusBarItem;

async function registerMCPServer(pythonPath: string, launcherPath: string, licenseKey?: string) {
    const config = vscode.workspace.getConfiguration();
    const mcpServers = config.get<Record<string, any>>('mcp.servers') || {};
    
    const env: Record<string, string> = {};
    if (licenseKey) {
        env.ANYRAG_LICENSE_KEY = licenseKey;
    }
    
    mcpServers.anyrag = {
        command: pythonPath,
        args: [launcherPath],
        env
    };
    
    await config.update('mcp.servers', mcpServers, vscode.ConfigurationTarget.Global);
}

async function unregisterMCPServer() {
    const config = vscode.workspace.getConfiguration();
    const mcpServers = config.get<Record<string, any>>('mcp.servers') || {};
    
    if (mcpServers.anyrag) {
        delete mcpServers.anyrag;
        await config.update('mcp.servers', mcpServers, vscode.ConfigurationTarget.Global);
    }
}

async function updateStatusBar() {
    if (!licenseManager || !statusBarItem) {
        return;
    }
    
    const info = await licenseManager.getLicenseInfo();
    const icon = info.tier === 'pro' ? '$(verified)' : '$(unlock)';
    const label = info.tier === 'pro' ? 'Pro' : 'Community';
    
    statusBarItem.text = `${icon} AnyRAG ${label}`;
    statusBarItem.tooltip = `AnyRAG Pilot ${info.tier.toUpperCase()}
Click for details`;
    
    // Update context for conditional command visibility
    await updateLicenseContext();
}

async function updateLicenseContext() {
    if (!licenseManager) {
        return;
    }
    
    const hasPro = await licenseManager.hasProAccess();
    await vscode.commands.executeCommand('setContext', 'anyrag:pro:active', hasPro);
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('=== AnyRAG Pilot Extension Activating ===');

    try {
        // Initialize license manager
        licenseManager = new LicenseManager(context);
        console.log('License manager initialized');

        // Initialize AnyRAG server (setup only, don't start yet)
        anyragServer = new AnyRAGServer(context);
        const licenseKey = await licenseManager.getLicenseKey();
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'AnyRAG Pilot',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Setting up AnyRAG environment...' });
            await anyragServer.initialize(licenseKey);
        });

        // Register MCP server in VS Code settings
        const storageUri = context.globalStorageUri;
        const pythonPath = process.platform === 'win32' 
            ? path.join(storageUri.fsPath, 'venv', 'Scripts', 'python.exe')
            : path.join(storageUri.fsPath, 'venv', 'bin', 'python3');
        const launcherPath = path.join(storageUri.fsPath, 'run_server.py');
        
        await registerMCPServer(pythonPath, launcherPath, licenseKey);
        
        console.log('AnyRAG MCP server registered globally');

        // Connect private MCP client for command handlers
        mcpClient = new MCPClient(pythonPath, launcherPath, storageUri.fsPath);
        await mcpClient.connect(licenseKey);
        console.log('MCP client connected for extension commands');
        
        // Register VS Code commands for UI integration
        registerCommands(context);
        
        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        await updateStatusBar();
        statusBarItem.command = 'anyrag-pilot.showLicenseInfo';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
        
        console.log('AnyRAG Pilot extension activated successfully');

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate AnyRAG Pilot: ${error}`);
        console.error('Activation error:', error);
    }
}

function registerCommands(context: vscode.ExtensionContext) {
    // Index Workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.indexWorkspace', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const folderPath = workspaceFolders[0].uri.fsPath;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing workspace',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'This may take a few minutes...' });
                
                try {
                    const result = await mcpClient.indexFolder({
                        folder_path: folderPath,
                        tags: ['workspace']
                    });
                    vscode.window.showInformationMessage(`Indexed ${result.files_indexed} files, ${result.chunks_created} chunks`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Indexing failed: ${error}`);
                }
            });
        })
    );

    // Index Folder
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.indexFolder', async (uri: vscode.Uri) => {
            const folderPath = uri?.fsPath || await vscode.window.showInputBox({
                prompt: 'Enter folder path to index'
            });

            if (!folderPath) {
                return;
            }

            // Show initial message
            vscode.window.showInformationMessage(`Indexing folder in background: ${path.basename(folderPath)}`);

            // Run indexing without progress notification to avoid timeout issues
            try {
                const result = await mcpClient.indexFolder({
                    folder_path: folderPath,
                    tags: ['folder']
                });
                vscode.window.showInformationMessage(`✓ Indexed ${result.files_indexed} files from ${path.basename(folderPath)}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Indexing failed: ${error}`);
            }
        })
    );

    // Index File
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.indexFile', async (uri: vscode.Uri) => {
            const filePath = uri?.fsPath || await vscode.window.showInputBox({
                prompt: 'Enter file path to index'
            });

            if (!filePath) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing file',
                cancellable: false
            }, async (progress) => {
                try {
                    const fileName = path.basename(filePath);
                    progress.report({ message: 'Indexing file...' });
                    
                    // Use the new index_file tool
                    const result = await mcpClient.indexFile({
                        file_path: filePath,
                        tags: ['file', fileName]
                    });
                    
                    // Parse the MCP response
                    let chunkCount = 0;
                    if (result?.text) {
                        const parsed = JSON.parse(result.text);
                        chunkCount = parsed.total_chunks || 0;
                    }
                    
                    vscode.window.showInformationMessage(`Indexed ${fileName} (${chunkCount} chunks)`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Indexing failed: ${error}`);
                }
            });
        })
    );

    // Index GitHub Repo
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.indexGitHubRepo', async () => {
            const repoUrl = await vscode.window.showInputBox({
                prompt: 'Enter GitHub repository URL (e.g., owner/repo or https://github.com/owner/repo)',
                placeHolder: 'fastapi/fastapi'
            });

            if (!repoUrl) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Indexing ${repoUrl}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Cloning and indexing repository...' });
                
                try {
                    const result = await mcpClient.indexGitHubRepo({
                        repo_url: repoUrl,
                        tags: ['github']
                    });
                    vscode.window.showInformationMessage(`Indexed ${result.files_indexed} files from ${repoUrl}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`GitHub indexing failed: ${error}`);
                }
            });
        })
    );

    // Show Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.showIndex', async () => {
            try {
                const indexData = await mcpClient.showIndex();
                
                if (indexData.sources.length === 0) {
                    vscode.window.showInformationMessage('No sources indexed yet. Use "Index Workspace" or "Index GitHub Repo" to get started.');
                    return;
                }

                const items = indexData.sources.map((source: IndexSource) => {
                    // Choose icon based on source type
                    let typeIcon = '$(folder)';
                    if (source.source_type === 'github') {
                        typeIcon = '$(repo)';
                    } else if (source.tags?.includes('file')) {
                        typeIcon = '$(file)';
                    } else if (source.tags?.includes('workspace')) {
                        typeIcon = '$(root-folder)';
                    }
                    
                    const activeStatus = source.active ? '$(check) Active' : '';
                    
                    return {
                        label: `${typeIcon} ${source.source_path}`,
                        description: activeStatus,
                        detail: `${(source.chunk_count || 0).toLocaleString()} chunks | Tags: ${source.tags?.join(', ') || 'none'}`,
                        source
                    };
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a source to manage'
                });

                if (!selected) {
                    return;
                }

                // Show action menu for selected source
                await showSourceActions(selected.source);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to show index: ${error}`);
            }
        })
    );

    async function showSourceActions(source: IndexSource) {
        const actions = [
            { label: '$(tag) Add Tags', description: 'Add new tags to this source', action: 'addTags' },
            { label: '$(close) Remove Tags', description: 'Remove existing tags', action: 'removeTags' },
            source.active 
                ? { label: '$(debug-pause) Deactivate Source', description: 'Exclude from searches', action: 'deactivate' }
                : { label: '$(play) Activate Source', description: 'Include in searches', action: 'activate' },
            { label: '$(trash) Remove Source', description: 'Delete permanently', action: 'remove' }
        ];

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: `Manage: ${source.source_path}`,
            matchOnDescription: true
        });

        if (!selected) {
            return;
        }

        switch (selected.action) {
            case 'addTags':
                await addTagsToSource(source);
                break;
            case 'removeTags':
                await removeTagsFromSource(source);
                break;
            case 'activate':
                await mcpClient.activateSource(source.source_id);
                vscode.window.showInformationMessage(`Activated: ${source.source_path}`);
                break;
            case 'deactivate':
                await mcpClient.deactivateSource(source.source_id);
                vscode.window.showInformationMessage(`Deactivated: ${source.source_path}`);
                break;
            case 'remove':
                const confirm = await vscode.window.showWarningMessage(
                    `Remove ${source.source_path}?`,
                    { modal: true },
                    'Remove'
                );
                if (confirm === 'Remove') {
                    await mcpClient.removeSource(source.source_id);
                    vscode.window.showInformationMessage(`Removed: ${source.source_path}`);
                }
                break;
        }
    }

    async function addTagsToSource(source: IndexSource) {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter tags to add (comma-separated)',
            placeHolder: 'important, review, backend',
            value: ''
        });

        if (!input) {
            return;
        }

        const tags = input.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (tags.length === 0) {
            return;
        }

        await mcpClient.addTags(source.source_id, tags);
        vscode.window.showInformationMessage(`Added tags: ${tags.join(', ')}`);
    }

    async function removeTagsFromSource(source: IndexSource) {
        if (!source.tags || source.tags.length === 0) {
            vscode.window.showInformationMessage('No tags to remove');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            source.tags.map(tag => ({ label: tag, picked: false })),
            {
                placeHolder: 'Select tags to remove',
                canPickMany: true
            }
        );

        if (!selected || selected.length === 0) {
            return;
        }

        const tags = selected.map(s => s.label);
        await mcpClient.removeTags(source.source_id, tags);
        vscode.window.showInformationMessage(`Removed tags: ${tags.join(', ')}`);
    }

    // Clear Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.clearIndex', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to clear all indexed content?',
                { modal: true },
                'Clear Index'
            );

            if (confirm === 'Clear Index') {
                try {
                    await mcpClient.clearIndex();
                    vscode.window.showInformationMessage('Index cleared successfully');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to clear index: ${error}`);
                }
            }
        })
    );

    // Activate License
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.activateLicense', async () => {
            const licenseKey = await vscode.window.showInputBox({
                prompt: 'Enter your AnyRAG Pro license key',
                placeHolder: 'ANYRAG-PRO-XXXX-XXXX-XXXX',
                password: true
            });

            if (!licenseKey) {
                return;
            }

            const result = await licenseManager.activateLicense(licenseKey);
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
                // Update status bar
                await updateStatusBar();
                // Reconnect MCP client with new license
                await mcpClient.disconnect();
                await mcpClient.connect(licenseKey);
                // Update global registration
                const storageUri = context.globalStorageUri;
                const pythonPath = process.platform === 'win32' 
                    ? path.join(storageUri.fsPath, 'venv', 'Scripts', 'python.exe')
                    : path.join(storageUri.fsPath, 'venv', 'bin', 'python3');
                const launcherPath = path.join(storageUri.fsPath, 'run_server.py');
                await registerMCPServer(pythonPath, launcherPath, licenseKey);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        })
    );

    // Show License Info
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.showLicenseInfo', async () => {
            const info = await licenseManager.getLicenseInfo();
            const tier = info.tier.toUpperCase();
            const featureList = info.features.length > 0 
                ? info.features.map(f => `  • ${f}`).join('\n')
                : '  • Basic indexing and search';
            
            const message = `AnyRAG Pilot License\n\nTier: ${tier}\nActive: ${info.active}\n\nFeatures:\n${featureList}`;
            
            if (info.tier === 'community') {
                const action = await vscode.window.showInformationMessage(
                    message,
                    { modal: true },
                    'Upgrade to Pro'
                );
                if (action === 'Upgrade to Pro') {
                    vscode.env.openExternal(vscode.Uri.parse('https://anyrag.dev/pricing'));
                }
            } else {
                vscode.window.showInformationMessage(message, { modal: true });
            }
        })
    );
    // Deactivate License
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.deactivateLicense', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to deactivate your Pro license on this machine?',
                { modal: true },
                'Deactivate'
            );

            if (confirm === 'Deactivate') {
                try {
                    await licenseManager.deactivateLicense();
                    await updateStatusBar();
                    vscode.window.showInformationMessage('License deactivated. Switched to Community Edition.');
                    // Optionally reload window
                    const reload = await vscode.window.showInformationMessage(
                        'Reload window to apply changes?',
                        'Reload',
                        'Later'
                    );
                    if (reload === 'Reload') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to deactivate license: ${error}`);
                }
            }
        })
    );}

export async function deactivate() {
    console.log('AnyRAG Pilot deactivating...');
    
    // Disconnect MCP client
    if (mcpClient) {
        await mcpClient.disconnect();
    }
    
    // Unregister MCP server from settings
    await unregisterMCPServer();
}