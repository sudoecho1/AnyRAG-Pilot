import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';

interface ValidationResponse {
  valid: boolean;
  tier?: string;
  features?: string[];
  message?: string;
  expiresAt?: string;
  signature?: string;
  timestamp?: number;
}

interface CachedValidation {
  response: ValidationResponse;
  timestamp: number;
}

export class LicenseManager {
  private static readonly LICENSE_KEY = 'anyrag.license';
  private static readonly CACHE_KEY = 'anyrag.validation.cache';
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly API_ENDPOINT = 'https://ragpilot-license-api.ragpilot.workers.dev/api/validate-license';
  
  // RSA public key for verifying server responses (safe to be public)
  private static readonly SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqqER/xTwHTCn+BMaNbR/
q6Xsk6NIF7VaFcoIXOJ3jwzQ/3/WprAknmlarB7jCFD9blAELQI3/h112biZeSqb
GwJgkTxjPgWUDKbmHkHaHxPlNiDw4xIQiUW79y008xSDn4DHMVsA4C5Zv+euxWJI
U4MjN3FZMygcFoK/hz492iZuBcHOQDgh6yaseihCmfanxEx2elBBH1O8KVhdl0XO
4WeTgoG2RTGeiRzT+3IrCEmU6Vd8uhni2mgcb32sHuBwSRQOZ1GziZsviqG8Akcx
Em8og0F/V+HzSJOLvu8aA/+2GRebBxItbT9ghXyveYykWzNN6qadtW7isNQ1/r3l
FwIDAQAB
-----END PUBLIC KEY-----`;

  private context: vscode.ExtensionContext;
  private validationCache?: CachedValidation;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadCache();
  }

  /**
   * Get current license key (for passing to MCP server)
   */
  async getLicenseKey(): Promise<string | undefined> {
    return await this.context.secrets.get(LicenseManager.LICENSE_KEY);
  }

  /**
   * Check if user has Pro access
   */
  async hasProAccess(): Promise<boolean> {
    try {
      const validation = await this.validateLicense();
      return validation.valid && (validation.tier === 'pro' || validation.tier === 'team');
    } catch (error) {
      console.error('License validation error:', error);
      return false;
    }
  }

  /**
   * Get current license tier
   */
  async getLicenseTier(): Promise<string> {
    try {
      const validation = await this.validateLicense();
      return validation.valid && validation.tier ? validation.tier : 'community';
    } catch (error) {
      console.error('License tier check error:', error);
      return 'community';
    }
  }

  /**
   * Get available features for current license
   */
  async getFeatures(): Promise<string[]> {
    try {
      const validation = await this.validateLicense();
      return validation.features || [];
    } catch (error) {
      return [];
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
      await this.context.secrets.store(LicenseManager.LICENSE_KEY, licenseKey);

      // Clear cache and validate
      this.clearCache();
      const validation = await this.validateLicense(true);

      if (validation.valid) {
        return {
          success: true,
          message: `License activated successfully! Tier: ${validation.tier?.toUpperCase()}`
        };
      } else {
        // Remove invalid license
        await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
        return { success: false, message: validation.message || 'License validation failed' };
      }
    } catch (error) {
      return { success: false, message: `Activation failed: ${error}` };
    }
  }

  /**
   * Deactivate current license
   */
  async deactivateLicense(): Promise<void> {
    try {
      const licenseKey = await this.context.secrets.get(LicenseManager.LICENSE_KEY);
      
      if (licenseKey) {
        const machineId = this.getMachineId();
        
        try {
          const response = await fetch(`${LicenseManager.API_ENDPOINT.replace('/validate-license', '/deactivate-license')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, machineId })
          });
          
          if (!response.ok) {
            console.warn('Failed to deactivate license on server, removing locally anyway');
          }
        } catch (error) {
          console.warn('Failed to contact license server for deactivation, removing locally anyway:', error);
        }
      }
      
      await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
      this.clearCache();
    } catch (error) {
      console.error('Deactivation error:', error);
      await this.context.secrets.delete(LicenseManager.LICENSE_KEY);
      this.clearCache();
    }
  }

  /**
   * Get current license information
   */
  async getLicenseInfo(): Promise<{
    active: boolean;
    tier: string;
    features: string[];
    expiresAt?: string;
  }> {
    try {
      const validation = await this.validateLicense();
      return {
        active: validation.valid,
        tier: validation.tier || 'community',
        features: validation.features || [],
        expiresAt: validation.expiresAt
      };
    } catch (error) {
      return {
        active: false,
        tier: 'community',
        features: []
      };
    }
  }

  /**
   * Force refresh license validation
   */
  async refreshLicense(): Promise<ValidationResponse> {
    this.clearCache();
    return this.validateLicense(true);
  }

  /**
   * Validate license with server (with caching)
   */
  private async validateLicense(force: boolean = false): Promise<ValidationResponse> {
    // Check cache first
    if (!force && this.validationCache) {
      const age = Date.now() - this.validationCache.timestamp;
      if (age < LicenseManager.CACHE_DURATION) {
        return this.validationCache.response;
      }
    }

    // Get license key from secure storage
    const licenseKey = await this.context.secrets.get(LicenseManager.LICENSE_KEY);
    if (!licenseKey) {
      const response: ValidationResponse = { valid: false, tier: 'community', features: [] };
      this.saveCache(response);
      return response;
    }

    // Call validation API
    try {
      const machineId = this.getMachineId();
      console.log('[License Validation] Calling API...');
      const response = await fetch(LicenseManager.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey,
          machineId
        })
      });

      console.log('[License Validation] Response status:', response.status, response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('License validation failed:', response.status, errorText);
        throw new Error(`Validation failed: ${response.status}`);
      }

      const validationResponse = await response.json() as ValidationResponse;
      console.log('License validation response:', validationResponse);
      
      // Verify RSA signature
      if (validationResponse.valid && !(await this.verifyResponseSignature(validationResponse))) {
        console.error('[License Validation] Invalid RSA signature');
        const invalidResponse: ValidationResponse = {
          valid: false,
          tier: 'community',
          features: [],
          message: 'License validation failed: Invalid server response'
        };
        this.saveCache(invalidResponse);
        return invalidResponse;
      }
      
      this.saveCache(validationResponse);
      return validationResponse;

    } catch (error) {
      console.error('License validation network error:', error);
      
      // If we have cached validation and network fails, use cache
      if (this.validationCache) {
        console.log('Using cached validation due to network error');
        return this.validationCache.response;
      }

      // Otherwise fail to community tier
      const fallbackResponse: ValidationResponse = {
        valid: false,
        tier: 'community',
        features: [],
        message: 'Network error - using Community tier'
      };
      return fallbackResponse;
    }
  }

  /**
   * Generate unique machine ID
   */
  private getMachineId(): string {
    const hostname = os.hostname();
    const machineId = vscode.env.machineId;
    const combined = `${hostname}-${machineId}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
  }

  /**
   * Load validation cache from workspace state
   */
  private loadCache(): void {
    const cached = this.context.workspaceState.get<CachedValidation>(LicenseManager.CACHE_KEY);
    if (cached) {
      this.validationCache = cached;
    }
  }

  /**
   * Save validation cache to workspace state
   */
  private saveCache(response: ValidationResponse): void {
    const cached: CachedValidation = {
      response,
      timestamp: Date.now()
    };
    this.validationCache = cached;
    this.context.workspaceState.update(LicenseManager.CACHE_KEY, cached);
  }

  /**
   * Clear validation cache
   */
  private clearCache(): void {
    this.validationCache = undefined;
    this.context.workspaceState.update(LicenseManager.CACHE_KEY, undefined);
  }

  /**
   * Verify RSA signature of API response
   */
  private async verifyResponseSignature(response: ValidationResponse): Promise<boolean> {
    if (!response.signature || !response.timestamp) {
      console.error('[License] Missing signature or timestamp');
      return false;
    }

    // Check timestamp freshness (within 5 minutes)
    const now = Date.now();
    if (Math.abs(now - response.timestamp) > 5 * 60 * 1000) {
      console.error('[License] Response timestamp too old or in future');
      return false;
    }

    try {
      const payload = JSON.stringify({
        valid: response.valid,
        tier: response.tier,
        features: response.features,
        expiresAt: response.expiresAt,
        timestamp: response.timestamp
      });

      const signature = Buffer.from(response.signature, 'base64');
      
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(payload);
      verifier.end();

      const isValid = verifier.verify(LicenseManager.SERVER_PUBLIC_KEY, signature);
      
      if (!isValid) {
        console.error('[License] RSA signature verification failed');
      }
      
      return isValid;
    } catch (error) {
      console.error('[License] Signature verification error:', error);
      return false;
    }
  }
}
