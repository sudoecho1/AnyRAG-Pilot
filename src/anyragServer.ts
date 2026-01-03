import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

export class AnyRAGServer {
    private serverProcess: cp.ChildProcess | null = null;
    private venvPath: string;
    private pythonPath: string;
    private binaryPath: string;
    private launcherPath: string;
    private isRunning: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        const storageUri = context.globalStorageUri;
        this.venvPath = path.join(storageUri.fsPath, 'venv');
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

        // Copy binary to storage
        const targetBinaryPath = path.join(storageUri.fsPath, path.basename(this.binaryPath));
        if (!fs.existsSync(targetBinaryPath)) {
            fs.copyFileSync(this.binaryPath, targetBinaryPath);
        }

        // Create launcher script
        await this.createLauncher();

        // Install dependencies
        await this.installDependencies();

        // Start MCP server
        await this.start(licenseKey);
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

    async start(licenseKey?: string): Promise<void> {
        if (this.isRunning) {
            return;
        }

        const env = { ...process.env };
        if (licenseKey) {
            env.ANYRAG_LICENSE_KEY = licenseKey;
        }

        this.serverProcess = cp.spawn(this.pythonPath, [this.launcherPath], {
            cwd: this.context.globalStorageUri.fsPath,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.serverProcess.stdout?.on('data', (data) => {
            console.log('[AnyRAG Server]', data.toString());
        });

        this.serverProcess.stderr?.on('data', (data) => {
            console.error('[AnyRAG Server]', data.toString());
        });

        this.serverProcess.on('exit', (code) => {
            console.log(`AnyRAG Server exited with code ${code}`);
            this.isRunning = false;
        });

        this.isRunning = true;

        // Wait for server to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    async stop(): Promise<void> {
        if (this.serverProcess && this.isRunning) {
            this.serverProcess.kill();
            this.serverProcess = null;
            this.isRunning = false;
        }
    }

    async restart(licenseKey?: string): Promise<void> {
        await this.stop();
        await this.start(licenseKey);
    }

    getStatus(): boolean {
        return this.isRunning;
    }
}
