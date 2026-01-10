import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

export class AnyRAGServer {
    private venvPath: string;
    private pythonPath: string;
    private binaryPath: string;
    private launcherPath: string;
    private isDevMode: boolean;
    private devSourcePath: string;

    constructor(private context: vscode.ExtensionContext) {
        const storageUri = context.globalStorageUri;
        // Dev mode for internal development only - not exposed to end users
        // Set ANYRAG_DEV_MODE=1 and ANYRAG_DEV_SOURCE=/path/to/AnyRAG to enable
        this.isDevMode = process.env.ANYRAG_DEV_MODE === '1';
        this.devSourcePath = process.env.ANYRAG_DEV_SOURCE || '';
        this.venvPath = path.join(storageUri.fsPath, this.isDevMode ? 'venv-dev' : 'venv');
        this.pythonPath = this.getPythonExecutable();
        this.binaryPath = this.getBinaryPath();
        this.launcherPath = path.join(storageUri.fsPath, 'run_server.py');
    }

    private getBinaryPath(): string {
        const platform = process.platform;
        const binariesDir = path.join(this.context.extensionPath, 'binaries');
        
        if (platform === 'win32') {
            return path.join(binariesDir, 'anyrag.cp313-win_amd64.pyd');
        } else if (platform === 'darwin') {
            return path.join(binariesDir, 'anyrag.cpython-313-darwin.so');
        } else {
            return path.join(binariesDir, 'anyrag.cpython-313-x86_64-linux-gnu.so');
        }
    }

    private getPythonExecutable(): string {
        // Check user configuration first
        const config = vscode.workspace.getConfiguration('anyragPilot');
        const configuredPath = config.get<string>('pythonPath');
        if (configuredPath) {
            return configuredPath;
        }

        // Auto-detect Python 3.13+
        const platform = process.platform;
        if (platform === 'win32') {
            return path.join(this.venvPath, 'Scripts', 'python.exe');
        } else {
            return path.join(this.venvPath, 'bin', 'python3');
        }
    }

    private async findSystemPython(): Promise<string> {
        const candidates = ['python3.13', 'python3.14', 'python3.12', 'python3', 'python'];
        
        for (const candidate of candidates) {
            try {
                const result = cp.execSync(`${candidate} --version`, { encoding: 'utf-8' });
                const version = result.match(/Python (\d+)\.(\d+)/);
                if (version) {
                    const major = parseInt(version[1]);
                    const minor = parseInt(version[2]);
                    if (major === 3 && minor >= 13) {
                        return candidate;
                    }
                }
            } catch {
                continue;
            }
        }
        
        throw new Error('Python 3.13+ not found. Please install Python 3.13 or configure anyragPilot.pythonPath');
    }

    async initialize(licenseKey?: string): Promise<void> {
        const storageUri = this.context.globalStorageUri;
        
        // Ensure storage directory exists
        if (!fs.existsSync(storageUri.fsPath)) {
            fs.mkdirSync(storageUri.fsPath, { recursive: true });
        }

        // Check if venv exists, create if not
        if (!fs.existsSync(this.venvPath)) {
            await this.createVenv();
        }

        // In dev mode, install from local source instead of using binary
        if (this.isDevMode) {
            if (!this.devSourcePath || !fs.existsSync(this.devSourcePath)) {
                throw new Error('Dev mode enabled but devSourcePath is not set or does not exist. Please configure anyragPilot.devSourcePath');
            }
            // Remove any existing binary to ensure source is used
            const targetBinaryPath = path.join(storageUri.fsPath, path.basename(this.binaryPath));
            if (fs.existsSync(targetBinaryPath)) {
                fs.unlinkSync(targetBinaryPath);
                console.log('[AnyRAG] Removed binary to use dev source');
            }
            // Install dependencies
            await this.installDependencies();
            // Install local AnyRAG in editable mode
            await this.installLocalSource();
        } else {
            // Production mode: Copy binary to storage
            const targetBinaryPath = path.join(storageUri.fsPath, path.basename(this.binaryPath));
            if (!fs.existsSync(targetBinaryPath)) {
                fs.copyFileSync(this.binaryPath, targetBinaryPath);
            }
            // Install dependencies
            await this.installDependencies();
        }

        // Create launcher script
        await this.createLauncher();

        // Don't start the server here - MCP client will start it via stdio transport
    }

    private async createVenv(): Promise<void> {
        const systemPython = await this.findSystemPython();
        
        return new Promise((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AnyRAG Pilot',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Creating Python environment...' });
                
                const proc = cp.spawn(systemPython, ['-m', 'venv', this.venvPath]);
                
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Failed to create venv (exit code ${code})`));
                    }
                });
                
                proc.on('error', reject);
            });
        });
    }

    private async createLauncher(): Promise<void> {
        const launcherContent = `#!/usr/bin/env python3
"""Launcher script for AnyRAG MCP server"""

if __name__ == "__main__":
    from anyrag.server import main
    main()
`;
        fs.writeFileSync(this.launcherPath, launcherContent, 'utf-8');
        
        // Make executable on Unix
        if (process.platform !== 'win32') {
            fs.chmodSync(this.launcherPath, 0o755);
        }
    }

    private async installDependencies(): Promise<void> {
        const pipPath = process.platform === 'win32' 
            ? path.join(this.venvPath, 'Scripts', 'pip.exe')
            : path.join(this.venvPath, 'bin', 'pip');

        const packages = [
            'fastmcp>=2.14.2',
            'sentence-transformers>=5.2.0',
            'chromadb>=1.4.0',
            'requests'
        ];

        return new Promise((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AnyRAG Pilot',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Installing dependencies (this may take a few minutes)...' });
                
                const proc = cp.spawn(pipPath, ['install', ...packages], {
                    cwd: this.context.globalStorageUri.fsPath
                });

                let output = '';
                proc.stdout?.on('data', (data) => {
                    output += data.toString();
                    console.log('[pip]', data.toString());
                });
                
                proc.stderr?.on('data', (data) => {
                    console.error('[pip]', data.toString());
                });
                
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Failed to install dependencies (exit code ${code})\n${output}`));
                    }
                });
                
                proc.on('error', reject);
            });
        });
    }

    private async installLocalSource(): Promise<void> {
        const pipPath = process.platform === 'win32' 
            ? path.join(this.venvPath, 'Scripts', 'pip.exe')
            : path.join(this.venvPath, 'bin', 'pip');

        return new Promise((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AnyRAG Pilot (Dev Mode)',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Installing local AnyRAG source...' });
                
                const proc = cp.spawn(pipPath, ['install', '-e', this.devSourcePath], {
                    cwd: this.context.globalStorageUri.fsPath
                });

                let output = '';
                proc.stdout?.on('data', (data) => {
                    output += data.toString();
                    console.log('[pip dev]', data.toString());
                });
                
                proc.stderr?.on('data', (data) => {
                    console.error('[pip dev]', data.toString());
                });
                
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Failed to install local AnyRAG (exit code ${code})\n${output}`));
                    }
                });
                
                proc.on('error', reject);
            });
        });
    }

    // Server lifecycle is managed by MCP SDK stdio transport
    // No need to manually start/stop
}
