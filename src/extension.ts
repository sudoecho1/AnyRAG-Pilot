import * as vscode from 'vscode';
import * as path from 'path';
import { AnyRAGServer } from './anyragServer.js';
import { LicenseManager } from './licenseManager.js';
import { MCPClient } from './mcpClient.js';

let anyragServer: AnyRAGServer;
let licenseManager: LicenseManager;
let mcpClient: MCPClient;

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

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing folder',
                cancellable: false
            }, async (progress) => {
                try {
                    const result = await mcpClient.indexFolder({
                        folder_path: folderPath,
                        tags: ['folder']
                    });
                    vscode.window.showInformationMessage(`Indexed ${result.files_indexed} files`);
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

                const items = indexData.sources.map(source => ({
                    label: `${source.source_type}: ${source.source_path}`,
                    description: `${source.document_count} docs, ${source.chunk_count} chunks`,
                    detail: `Tags: ${source.tags?.join(', ') || 'none'} | Active: ${source.active}`,
                    source
                }));

                vscode.window.showQuickPick(items, {
                    placeHolder: 'Indexed sources'
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to show index: ${error}`);
            }
        })
    );

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
            const features = info.features.length > 0 ? info.features.join(', ') : 'Basic features';
            
            vscode.window.showInformationMessage(
                `AnyRAG Pilot License\n\nTier: ${tier}\nActive: ${info.active}\nFeatures: ${features}`,
                { modal: true }
            );
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