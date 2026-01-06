import * as vscode from 'vscode';
import * as path from 'path';
import { AnyRAGServer } from './anyragServer.js';
import { LicenseManager } from './licenseManager.js';
import { MCPClient, IndexSource } from './mcpClient.js';
import { PurchaseFlow } from './purchaseFlow.js';
import { ChatParticipant } from './chatParticipant.js';
import { ChatSessionIndexer } from './chatSessionIndexer.js';

let anyragServer: AnyRAGServer;
let licenseManager: LicenseManager;
let mcpClient: MCPClient;
let chatSessionIndexer: ChatSessionIndexer;
let statusBarItem: vscode.StatusBarItem;
let indexStatusBarItem: vscode.StatusBarItem;
let purchaseFlow: PurchaseFlow;
let activeIndex: string = 'default';

async function registerMCPServer(pythonPath: string, launcherPath: string, licenseKey?: string, storageDir?: string) {
    const config = vscode.workspace.getConfiguration();
    const mcpServers = config.get<Record<string, any>>('mcp.servers') || {};
    
    const env: Record<string, string> = {};
    if (licenseKey) {
        env.ANYRAG_LICENSE_KEY = licenseKey;
    }
    if (storageDir) {
        env.ANYRAG_STORAGE_DIR = storageDir;
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

function updateIndexStatusBar() {
    if (!indexStatusBarItem) {
        return;
    }
    
    indexStatusBarItem.text = `$(database) ${activeIndex}`;
    indexStatusBarItem.tooltip = `Active Index: ${activeIndex}
Click to switch indices`;
}

export async function activate(context: vscode.ExtensionContext) {

    try {
        // Initialize license manager
        licenseManager = new LicenseManager(context);
        
        // Set initial license context (will be updated after validation)
        await updateLicenseContext();

        // Initialize purchase flow
        purchaseFlow = new PurchaseFlow(context);

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
        const isDevMode = process.env.ANYRAG_DEV_MODE === '1';
        const venvDir = isDevMode ? 'venv-dev' : 'venv';
        const pythonPath = process.platform === 'win32' 
            ? path.join(storageUri.fsPath, venvDir, 'Scripts', 'python.exe')
            : path.join(storageUri.fsPath, venvDir, 'bin', 'python3');
        const launcherPath = path.join(storageUri.fsPath, 'run_server.py');
        await registerMCPServer(pythonPath, launcherPath, licenseKey, storageUri.fsPath);

        // Connect private MCP client for command handlers
        mcpClient = new MCPClient(pythonPath, launcherPath, storageUri.fsPath);
        await mcpClient.connect(licenseKey);

        // Initialize chat session indexer
        chatSessionIndexer = new ChatSessionIndexer(mcpClient);

        // Register VS Code commands for UI integration
        registerCommands(context);

        // Register chat participant
        const chatParticipant = new ChatParticipant(mcpClient, () => activeIndex, chatSessionIndexer, context);
        const participant = vscode.chat.createChatParticipant('anyrag-pilot.assistant', chatParticipant.handleRequest.bind(chatParticipant));
        context.subscriptions.push(participant);

        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        await updateStatusBar();
        statusBarItem.command = 'anyrag-pilot.showLicenseInfo';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Create index selector status bar item
        indexStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        updateIndexStatusBar();
        indexStatusBarItem.command = 'anyrag-pilot.switchIndex';
        indexStatusBarItem.show();
        context.subscriptions.push(indexStatusBarItem);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate AnyRAG Pilot: ${error}`);
        console.error('Activation error:', error);
    }
}

// Helper to get the configured embedding model (resolving 'custom' to actual model name)
function getEmbeddingModel(): string {
    const config = vscode.workspace.getConfiguration('anyragPilot');
    let embeddingModel = config.get<string>('embeddingModel', 'all-MiniLM-L6-v2');
    
    // If custom model selected, get the custom model name
    if (embeddingModel === 'custom') {
        const customModel = config.get<string>('customEmbeddingModel', '');
        if (!customModel) {
            vscode.window.showWarningMessage('Custom embedding model selected but customEmbeddingModel setting is empty. Using default model.');
            return 'all-MiniLM-L6-v2';
        }
        return customModel;
    }
    
    return embeddingModel;
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
            const folderName = path.basename(folderPath);
            
            try {
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Indexing workspace',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'This may take a few minutes...', increment: -1 });
                    return await mcpClient.indexFolder({
                        folder_path: folderPath,
                        tags: ['workspace'],
                        model_name: getEmbeddingModel(),
                        index_name: activeIndex
                    });
                });
                
                vscode.window.showInformationMessage(`Indexed ${result.files_indexed} files, ${result.chunks_created} chunks`);
            } catch (error: any) {
                // MCP SDK timeout - indexing continues silently in background
                if (!error.message?.includes('timeout') && !error.message?.includes('timed out')) {
                    vscode.window.showErrorMessage(`Indexing failed: ${error}`);
                }
            }
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

            const folderName = path.basename(folderPath);

            // Show progress notification
            try {
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Indexing ${folderName}`,
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Processing files...', increment: -1 });
                    return await mcpClient.indexFolder({
                        folder_path: folderPath,
                        tags: ['folder'],
                        model_name: getEmbeddingModel(),
                        index_name: activeIndex
                    });
                });
                
                vscode.window.showInformationMessage(`✓ Indexed ${result.files_indexed} files from ${folderName}`);
            } catch (error: any) {
                // MCP SDK timeout - indexing continues silently in background
                if (!error.message?.includes('timeout') && !error.message?.includes('timed out')) {
                    vscode.window.showErrorMessage(`Indexing failed: ${error}`);
                }
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

            const fileName = path.basename(filePath);
            
            try {
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Indexing ${fileName}`,
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Processing file...', increment: -1 });
                    return await mcpClient.indexFile({
                        file_path: filePath,
                        tags: ['file', fileName],
                        model_name: getEmbeddingModel(),
                        index_name: activeIndex
                    });
                });
                
                // Get chunk count from response
                const chunkCount = result.total_chunks || 0;
                
                vscode.window.showInformationMessage(`✓ Indexed ${fileName} (${chunkCount} chunks)`);
            } catch (error) {
                vscode.window.showErrorMessage(`Indexing failed: ${error}`);
            }
        })
    );

    // Index Chat Session
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.indexChatSession', async () => {
            await chatSessionIndexer.selectAndIndexChatSession(context, activeIndex);
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

            try {
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Indexing ${repoUrl} into "${activeIndex}"`,
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Cloning and indexing repository...', increment: -1 });
                    return await mcpClient.indexGitHubRepo({
                        repo_url: repoUrl,
                        tags: ['github'],
                        model_name: getEmbeddingModel(),
                        index_name: activeIndex
                    });
                });
                
                vscode.window.showInformationMessage(`✓ Indexed ${result.files_indexed} files from ${repoUrl} into index "${activeIndex}"`);
            } catch (error: any) {
                // MCP SDK timeout - indexing continues silently in background
                if (!error.message?.includes('timeout') && !error.message?.includes('timed out')) {
                    vscode.window.showErrorMessage(`GitHub indexing failed: ${error}`);
                }
            }
        })
    );

    // Show Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.showIndex', async () => {
            try {
                const indexData = await mcpClient.showIndex(false, undefined, activeIndex);
                if (indexData.sources.length === 0) {
                    vscode.window.showInformationMessage(`No sources indexed in "${activeIndex}" yet. Use "Index Workspace" or "Index GitHub Repo" to get started.`);
                    return;
                }

                // Add back button as first item
                const items = [
                    {
                        label: '$(arrow-left) Back to List Indices',
                        description: '',
                        detail: 'Return to indices menu',
                        source: null as any
                    },
                    ...indexData.sources.map((source: IndexSource) => {
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
                    })
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a source to manage'
                });

                if (!selected) {
                    return;
                }

                // Handle back button
                if (!selected.source) {
                    await vscode.commands.executeCommand('anyrag-pilot.listIndices');
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
        // Check if this is a chat source
        const isChatSource = source.tags?.includes('chat') || source.tags?.includes('conversation');
        
        const actions = [
            { label: '$(arrow-left) Back', description: 'Return to source list', action: 'back' },
            { label: '$(tag) Add Tags', description: 'Add new tags to this source', action: 'addTags' },
            { label: '$(close) Remove Tags', description: 'Remove existing tags', action: 'removeTags' },
            ...(isChatSource ? [{ label: '$(edit) Rename Chat', description: 'Change chat name', action: 'rename' }] : []),
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

        if (selected.action === 'back') {
            // Re-run the command to go back to source list
            await vscode.commands.executeCommand('anyrag-pilot.showIndex');
            return;
        }

        switch (selected.action) {
            case 'addTags':
                await addTagsToSource(source);
                break;
            case 'removeTags':
                await removeTagsFromSource(source);
                break;
            case 'rename':
                await renameSource(source);
                break;
            case 'activate':
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Activating source',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Updating index...', increment: -1 });
                    await mcpClient.activateSource(source.source_id, activeIndex);
                });
                vscode.window.showInformationMessage(`Activated: ${source.source_path}`);
                break;
            case 'deactivate':
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Deactivating source',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Updating index...', increment: -1 });
                    await mcpClient.deactivateSource(source.source_id, activeIndex);
                });
                vscode.window.showInformationMessage(`Deactivated: ${source.source_path}`);
                break;
            case 'remove':
                const confirm = await vscode.window.showWarningMessage(
                    `Remove ${source.source_path}?`,
                    { modal: true },
                    'Remove'
                );
                if (confirm === 'Remove') {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Removing ${path.basename(source.source_path)}`,
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ message: 'Removing source from index...', increment: -1 });
                        await mcpClient.removeSource(source.source_id, activeIndex);
                    });
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

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Adding tags',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Updating source tags...', increment: -1 });
            await mcpClient.addTags(source.source_id, tags, activeIndex);
        });
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
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Removing tags',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Updating source tags...', increment: -1 });
            await mcpClient.removeTags(source.source_id, tags, activeIndex);
        });
        vscode.window.showInformationMessage(`Removed tags: ${tags.join(', ')}`);
    }

    async function renameSource(source: IndexSource) {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name for this chat',
            placeHolder: 'my-chat-name',
            value: source.source_id,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                if (value === source.source_id) {
                    return 'Name must be different from current name';
                }
                // Validate for source_id (alphanumeric, underscores, hyphens, dots)
                if (!/^[a-zA-Z0-9_\-\.]+$/.test(value)) {
                    return 'Name can only contain letters, numbers, underscores, hyphens, and dots';
                }
                return undefined;
            }
        });

        if (!newName) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Renaming chat',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Updating chat name...', increment: -1 });
                const result = await mcpClient.renameSource(source.source_id, newName.trim(), activeIndex);
                
                if (result.text) {
                    const data = JSON.parse(result.text);
                    if (!data.success) {
                        throw new Error(data.error || 'Failed to rename chat');
                    }
                }
            });
            vscode.window.showInformationMessage(`Renamed "${source.source_id}" to "${newName}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename chat: ${error}`);
        }
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
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Clearing index',
                    cancellable: false
                }, async () => {
                    try {
                        await mcpClient.clearIndex(activeIndex);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to clear index: ${error}`);
                        throw error;
                    }
                });
                vscode.window.showInformationMessage('Index cleared successfully');
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
                    await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                }
            } else {
                vscode.window.showInformationMessage(message, { modal: true });
            }
        })
    );
    
    // Upgrade to Pro
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.upgradeToPro', async () => {
            await purchaseFlow.showPurchaseOptions();
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
    );
    
    // Index Management Commands
    
    // Create Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.createIndex', async () => {
            // Check if user has Pro access
            const hasPro = await licenseManager.hasProAccess();
            if (!hasPro) {
                const upgrade = await vscode.window.showErrorMessage(
                    'Custom indices require Pro tier. Community tier is limited to the default index.',
                    { modal: true },
                    'Upgrade to Pro',
                    'Learn More'
                );
                
                if (upgrade === 'Upgrade to Pro') {
                    await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                } else if (upgrade === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://ragpilot.dev/pricing'));
                }
                return;
            }
            
            // Check existing indices first
            let existingIndices: string[] = [];
            try {
                const indicesResult = await mcpClient.listIndices();
                if (indicesResult.indices) {
                    existingIndices = indicesResult.indices.map((idx: any) => idx.name);
                }
            } catch (error) {
                console.error('[createIndex] Failed to list existing indices:', error);
            }

            const indexName = await vscode.window.showInputBox({
                prompt: 'Enter name for new index',
                placeHolder: 'e.g., code-bge, docs-mpnet',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Index name cannot be empty';
                    }
                    if (value === 'default') {
                        return 'Cannot create index named "default"';
                    }
                    if (!/^[a-z0-9-_]+$/.test(value)) {
                        return 'Index name can only contain lowercase letters, numbers, hyphens, and underscores';
                    }
                    if (existingIndices.includes(value)) {
                        return `Index "${value}" already exists`;
                    }
                    return null;
                }
            });
            
            if (!indexName) {
                return;
            }
            
            // Show model selection with presets
            const modelOptions = [
                {
                    label: 'all-MiniLM-L6-v2',
                    description: 'Fast, 384d (Recommended)',
                    detail: 'Best for general use - fast indexing and good accuracy',
                    model: 'all-MiniLM-L6-v2'
                },
                {
                    label: 'all-MiniLM-L12-v2',
                    description: 'Balanced, 384d',
                    detail: 'Good balance between speed and quality',
                    model: 'all-MiniLM-L12-v2'
                },
                {
                    label: 'all-mpnet-base-v2',
                    description: 'Best quality, 768d',
                    detail: 'Highest accuracy but slower indexing',
                    model: 'all-mpnet-base-v2'
                },
                {
                    label: '$(edit) Custom Model',
                    description: 'Enter custom HuggingFace model',
                    detail: 'Pro tier: Use any compatible sentence-transformers model',
                    model: 'custom'
                }
            ];
            
            const selectedModel = await vscode.window.showQuickPick(modelOptions, {
                placeHolder: 'Select embedding model for this index'
            });
            
            if (!selectedModel) {
                return;
            }
            
            let modelName = selectedModel.model;
            
            // If custom selected, prompt for model name
            if (modelName === 'custom') {
                const customModel = await vscode.window.showInputBox({
                    prompt: 'Enter HuggingFace model name',
                    placeHolder: 'e.g., BAAI/bge-large-en-v1.5, sentence-transformers/multi-qa-mpnet-base-dot-v1'
                });
                
                if (!customModel) {
                    return;
                }
                
                modelName = customModel;
            }
            
            try {
                const result = await mcpClient.createIndex(indexName, modelName);
                console.log('[createIndex] Result:', JSON.stringify(result, null, 2));
                
                if (result.error) {
                    // Check if it's a tier limitation error
                    if (result.tier === 'community' || result.error.includes('Community tier')) {
                        const upgrade = await vscode.window.showErrorMessage(
                            'Custom indices require Pro tier. Community tier is limited to the default index.',
                            { modal: true },
                            'Upgrade to Pro',
                            'Learn More'
                        );
                        
                        if (upgrade === 'Upgrade to Pro') {
                            await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                        } else if (upgrade === 'Learn More') {
                            vscode.env.openExternal(vscode.Uri.parse('https://ragpilot.dev/pricing'));
                        }
                    } else {
                        vscode.window.showErrorMessage(`Failed to create index: ${result.error}`);
                    }
                } else {
                    vscode.window.showInformationMessage(`✓ Created index "${indexName}" with model ${result.model_name}`);
                    // Switch to the new index
                    activeIndex = indexName;
                    updateIndexStatusBar();
                }
            } catch (error: any) {
                console.error('[createIndex] Error:', error);
                vscode.window.showErrorMessage(`Failed to create index: ${error.message}`);
            }
        })
    );
    
    // Switch Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.switchIndex', async () => {
            // Check if user has Pro access
            const hasPro = await licenseManager.hasProAccess();
            if (!hasPro) {
                const upgrade = await vscode.window.showErrorMessage(
                    'Switching between custom indices requires Pro tier. Community tier uses the default index only.',
                    { modal: true },
                    'Upgrade to Pro',
                    'Learn More'
                );
                
                if (upgrade === 'Upgrade to Pro') {
                    await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                } else if (upgrade === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://ragpilot.dev/pricing'));
                }
                return;
            }
            
            try {
                const indicesResult = await mcpClient.listIndices();
                
                if (indicesResult.error) {
                    vscode.window.showErrorMessage(`Failed to list indices: ${indicesResult.error}`);
                    return;
                }
                
                const indices = indicesResult.indices || [];
                
                if (indices.length === 0) {
                    vscode.window.showInformationMessage('No indices found. Creating default index...');
                    return;
                }
                
                interface IndexItem extends vscode.QuickPickItem {
                    indexName: string;
                }
                
                const items: IndexItem[] = indices.map((idx: any) => ({
                    label: idx.name,
                    description: `${idx.model_name} (${idx.document_count} docs)`,
                    detail: `Created: ${new Date(idx.created_at * 1000).toLocaleString()}`,
                    indexName: idx.name
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Current: ${activeIndex}`
                });
                
                if (selected) {
                    activeIndex = selected.indexName;
                    updateIndexStatusBar();
                    vscode.window.showInformationMessage(`Switched to index "${activeIndex}"`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to switch index: ${error.message}`);
            }
        })
    );
    
    // List Indices
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.listIndices', async () => {
            // Check if user has Pro access
            const hasPro = await licenseManager.hasProAccess();
            if (!hasPro) {
                const upgrade = await vscode.window.showErrorMessage(
                    'Viewing custom indices requires Pro tier. Community tier uses the default index only.',
                    { modal: true },
                    'Upgrade to Pro',
                    'Learn More'
                );
                
                if (upgrade === 'Upgrade to Pro') {
                    await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                } else if (upgrade === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://ragpilot.dev/pricing'));
                }
                return;
            }
            
            try {
                const result = await mcpClient.listIndices();
                
                if (result.error) {
                    vscode.window.showErrorMessage(`Failed to list indices: ${result.error}`);
                    return;
                }
                
                const indices = result.indices || [];
                
                if (indices.length === 0) {
                    vscode.window.showInformationMessage('No indices found.');
                    return;
                }
                
                interface IndexItem extends vscode.QuickPickItem {
                    indexName: string;
                }
                
                const items: IndexItem[] = indices.map((idx: any) => ({
                    label: idx.name === activeIndex ? `$(check) ${idx.name}` : idx.name,
                    description: `${idx.model_name} • ${idx.document_count} docs`,
                    detail: `Created: ${new Date(idx.created_at * 1000).toLocaleString()}`,
                    indexName: idx.name
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Select an index (current: ${activeIndex})`,
                    title: 'AnyRAG Indices'
                });
                
                if (!selected) {
                    return;
                }
                
                // Show action menu
                const actions = [
                    { label: '$(arrow-left) Back', value: 'back' },
                    { label: '$(arrow-swap) Switch and show sources', value: 'switch' },
                    { label: '$(edit) Rename this index', value: 'rename' }
                ];
                
                // Add delete option for non-default indices
                if (selected.indexName !== 'default') {
                    actions.push({ label: '$(trash) Delete this index', value: 'delete' });
                }
                
                const action = await vscode.window.showQuickPick(actions, {
                    placeHolder: `What would you like to do with "${selected.indexName}"?`
                });
                
                if (!action) {
                    return;
                }
                
                if (action.value === 'back') {
                    // Re-run the command to go back to index list
                    await vscode.commands.executeCommand('anyrag-pilot.listIndices');
                    return;
                } else if (action.value === 'switch') {
                    if (selected.indexName !== activeIndex) {
                        activeIndex = selected.indexName;
                        updateIndexStatusBar();
                        vscode.window.showInformationMessage(`Switched to index "${activeIndex}"`);
                    }
                    // Show indexed sources for this index
                    await vscode.commands.executeCommand('anyrag-pilot.showIndex');
                    return;
                } else if (action.value === 'delete') {
                    const confirm = await vscode.window.showWarningMessage(
                        `Delete index "${selected.indexName}" and all its documents?`,
                        { modal: true },
                        'Delete'
                    );
                    
                    if (confirm === 'Delete') {
                        try {
                            const result = await mcpClient.deleteIndex(selected.indexName);
                            
                            if (result.error) {
                                vscode.window.showErrorMessage(`Failed to delete index: ${result.error}`);
                            } else {
                                vscode.window.showInformationMessage(`✓ Deleted index "${selected.indexName}"`);
                                
                                // If we deleted the active index, switch to default
                                if (activeIndex === selected.indexName) {
                                    activeIndex = 'default';
                                    updateIndexStatusBar();
                                }
                            }
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`Failed to delete index: ${error.message}`);
                        }
                    }
                } else if (action.value === 'rename') {
                    // Get existing indices for validation
                    const existingNames = indices.map((idx: any) => idx.name);
                    
                    const newName = await vscode.window.showInputBox({
                        prompt: `Rename index "${selected.indexName}"`,
                        value: selected.indexName,
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return 'Index name cannot be empty';
                            }
                            if (value === 'default') {
                                return 'Cannot rename to "default"';
                            }
                            if (selected.indexName === 'default') {
                                return 'Cannot rename the "default" index';
                            }
                            if (!/^[a-z0-9-_]+$/.test(value)) {
                                return 'Index name can only contain lowercase letters, numbers, hyphens, and underscores';
                            }
                            if (existingNames.includes(value) && value !== selected.indexName) {
                                return `Index "${value}" already exists`;
                            }
                            return null;
                        }
                    });
                    
                    if (newName && newName !== selected.indexName) {
                        try {
                            const renameResult = await mcpClient.renameIndex(selected.indexName, newName);
                            
                            if (renameResult.error) {
                                vscode.window.showErrorMessage(`Failed to rename index: ${renameResult.error}`);
                            } else {
                                vscode.window.showInformationMessage(`✓ Renamed index "${selected.indexName}" to "${newName}"`);
                                
                                // If we renamed the active index, update it
                                if (activeIndex === selected.indexName) {
                                    activeIndex = newName;
                                    updateIndexStatusBar();
                                }
                            }
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`Failed to rename index: ${error.message}`);
                        }
                    }
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to list indices: ${error.message}`);
            }
        })
    );
    
    // Delete Index
    context.subscriptions.push(
        vscode.commands.registerCommand('anyrag-pilot.deleteIndex', async () => {
            // Check if user has Pro access
            const hasPro = await licenseManager.hasProAccess();
            if (!hasPro) {
                const upgrade = await vscode.window.showErrorMessage(
                    'Deleting custom indices requires Pro tier. Community tier is limited to the default index.',
                    { modal: true },
                    'Upgrade to Pro',
                    'Learn More'
                );
                
                if (upgrade === 'Upgrade to Pro') {
                    await vscode.commands.executeCommand('anyrag-pilot.upgradeToPro');
                } else if (upgrade === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://ragpilot.dev/pricing'));
                }
                return;
            }
            
            try {
                const indicesResult = await mcpClient.listIndices();
                
                if (indicesResult.error) {
                    vscode.window.showErrorMessage(`Failed to list indices: ${indicesResult.error}`);
                    return;
                }
                
                const indices = (indicesResult.indices || []).filter((idx: any) => idx.name !== 'default');
                
                if (indices.length === 0) {
                    vscode.window.showInformationMessage('No indices to delete (cannot delete "default" index).');
                    return;
                }
                
                interface IndexItem extends vscode.QuickPickItem {
                    indexName: string;
                }
                
                const items: IndexItem[] = indices.map((idx: any) => ({
                    label: idx.name,
                    description: `${idx.model_name} (${idx.document_count} docs)`,
                    indexName: idx.name
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select index to delete'
                });
                
                if (!selected) {
                    return;
                }
                
                const confirm = await vscode.window.showWarningMessage(
                    `Delete index "${selected.indexName}" and all its documents?`,
                    { modal: true },
                    'Delete'
                );
                
                if (confirm === 'Delete') {
                    const result = await mcpClient.deleteIndex(selected.indexName);
                    
                    if (result.error) {
                        vscode.window.showErrorMessage(`Failed to delete index: ${result.error}`);
                    } else {
                        vscode.window.showInformationMessage(`✓ Deleted index "${selected.indexName}"`);
                        
                        // If we deleted the active index, switch to default
                        if (activeIndex === selected.indexName) {
                            activeIndex = 'default';
                            updateIndexStatusBar();
                        }
                    }
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to delete index: ${error.message}`);
            }
        })
    );
}

export async function deactivate() {
    console.log('AnyRAG Pilot deactivating...');
    
    // Disconnect MCP client
    if (mcpClient) {
        await mcpClient.disconnect();
    }
    
    // Unregister MCP server from settings
    await unregisterMCPServer();
}