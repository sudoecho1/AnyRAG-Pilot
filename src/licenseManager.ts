import * as vscode from 'vscode';

interface LicenseInfo {
  tier: string;
  valid: boolean;
  limits?: {
    documents: number | string;
    active_sources: number | string;
    max_chats: number | string;
  };
  email?: string;
  expires?: string;
}

export class LicenseManager {
  private static readonly LICENSE_KEY = 'anyrag.license';
  private context: vscode.ExtensionContext;
  private mcpClient: any; // Will be injected

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Inject MCP client for calling Python server
   */
  setMCPClient(client: any): void {
    this.mcpClient = client;
  }

  /**
   * Get stored license key
   */
  async getLicenseKey(): Promise<string | undefined> {
    return await this.context.secrets.get(LicenseManager.LICENSE_KEY);
  }

  /**
   * Store license key in secrets
   */
  async storeLicenseKey(licenseKey: string): Promise<void> {
    await this.context.secrets.store(LicenseManager.LICENSE_KEY, licenseKey);
  }

  /**
   * Check if user has Pro access (queries Python MCP server)
   */
  async hasProAccess(): Promise<boolean> {
    try {
      const info = await this.getLicenseInfoFromMCP();
      return info.tier === 'pro';
    } catch (error) {
      console.error('License check error:', error);
      return false;
    }
  }

  /**
   * Get current license tier (queries Python MCP server)
   */
  async getLicenseTier(): Promise<string> {
    try {
      const info = await this.getLicenseInfoFromMCP();
      return info.tier;
    } catch (error) {
      console.error('License tier check error:', error);
      return 'community';
    }
  }

  /**
   * Get license info from Python MCP server
   */
  private async getLicenseInfoFromMCP(): Promise<LicenseInfo> {
    if (!this.mcpClient) {
      return { tier: 'community', valid: true };
    }

    try {
      const result = await this.mcpClient.showLicenseInfo();
      return result as LicenseInfo;
    } catch (error) {
      console.error('MCP license info call failed:', error);
      return { tier: 'community', valid: true };
    }
  }

  /**
   * Get current license information for display
   */
  async getLicenseInfo(): Promise<{
    active: boolean;
    tier: string;
    features: string[];
    expiresAt?: string;
  }> {
    try {
      const info = await this.getLicenseInfoFromMCP();
      
      // Convert limits to features list
      const features: string[] = [];
      if (info.limits) {
        const docs = info.limits.documents;
        const sources = info.limits.active_sources;
        const chats = info.limits.max_chats;
        
        features.push(`Documents: ${docs}`);
        features.push(`Active Sources: ${sources}`);
        features.push(`Chat Sessions: ${chats}`);
      }
      
      if (info.tier === 'pro') {
        features.push('Multiple Indices');
        features.push('Custom Embedding Models');
      }
      
      return {
        active: info.valid,
        tier: info.tier,
        features,
        expiresAt: info.expires
      };
    } catch (error) {
      console.error('Get license info error:', error);
      return {
        active: false,
        tier: 'community',
        features: ['Documents: 1000', 'Active Sources: 1', 'Chat Sessions: 1']
      };
    }
  }

  /**
   * Activate a new license key
   */
  async activateLicense(licenseKey: string): Promise<{ success: boolean; message: string }> {
    try {
      // Validate format
      if (!licenseKey.startsWith('ANYRAG-PRO-')) {
        return { success: false, message: 'Invalid license key format' };
      }

      // Store license key
      console.log('[LicenseManager] Storing license key in secrets...');
      await this.context.secrets.store(LicenseManager.LICENSE_KEY, licenseKey);
      
      // Verify it was stored
      const stored = await this.context.secrets.get(LicenseManager.LICENSE_KEY);
      console.log('[LicenseManager] Verification - key stored:', stored ? `${stored.substring(0, 20)}...` : 'FAILED');

      // Validate with Python server
      const info = await this.getLicenseInfoFromMCP();
      console.log('[LicenseManager] MCP validation result:', info);

      if (info.tier === 'pro') {
        return {
          success: true,
          message: `License activated successfully! Tier: PRO`
        };
      } else {
        // Remove invalid license
        await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
        return { success: false, message: 'License validation failed - license may be expired or invalid' };
      }
    } catch (error) {
      console.error('[LicenseManager] Activation error:', error);
      return { success: false, message: `Activation failed: ${error}` };
    }
  }

  /**
   * Deactivate current license
   */
  async deactivateLicense(): Promise<void> {
    try {
      // Call Python MCP server to deactivate
      if (this.mcpClient) {
        try {
          await this.mcpClient.deactivateLicense();
        } catch (error) {
          console.warn('MCP deactivation failed:', error);
        }
      }
      
      // Remove from local secrets
      await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
    } catch (error) {
      console.error('Deactivation error:', error);
      await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
    }
  }
}
