
/**
 * Automated Configuration Guardrails
 *
 * This module provides a mechanism to validate configuration objects
 * against a strict schema to prevent unknown or malformed options
 * from reaching production.
 */

export interface ConfigurationSchema {
  [key: string]: unknown;
}

export class ConfigurationGuardrail {
  private allowedKeys: Set<string>;

  constructor(allowedKeys: string[]) {
    this.allowedKeys = new Set(allowedKeys);
  }

  validate(config: ConfigurationSchema): void {
    const keys = Object.keys(config);
    for (const key of keys) {
      if (!this.allowedKeys.has(key)) {
        throw new Error(`[Guardrail] Unknown configuration option detected: ${key}`);
      }
    }
  }
}
