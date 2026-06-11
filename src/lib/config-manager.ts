import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

/**
 * Interface for ConfigManager options.
 */
export interface ConfigManagerOptions<T> {
  /** The filepath to read/write the configuration. */
  filePath: string;
  /** Default configuration fallback value. */
  defaultConfig: T;
  /** Optional Zod schema for validating configuration integrity. */
  schema?: z.ZodType<T>;
  /** Optional custom logger. Defaults to console. */
  logger?: {
    warn: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
  };
}

/**
 * Utility for performing atomic file writes.
 */
export class AtomicWriter {
  /**
   * Writes data atomically by writing to a temporary file,
   * then renaming the temporary file to the destination path.
   * 
   * @param filePath Target file path
   * @param content Content string to write
   */
  public static async write(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${filePath}.tmp.${Math.random().toString(36).substring(2, 10)}`;

    try {
      await fs.promises.writeFile(tempPath, content, 'utf8');
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tempPath);
      } catch (_) {
        // Ignore unlink failure during cleanup
      }
      throw error;
    }
  }

  /**
   * Synchronous version of atomic write.
   * 
   * @param filePath Target file path
   * @param content Content string to write
   */
  public static writeSync(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${filePath}.tmp.${Math.random().toString(36).substring(2, 10)}`;

    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (_) {
        // Ignore unlink failure during cleanup
      }
      throw error;
    }
  }
}

/**
 * Robust manager for configuration files with atomic writes, JSON validation,
 * and automatic fallback to defaults on corruption or syntax errors.
 */
export class ConfigManager<T> {
  private readonly filePath: string;
  private readonly defaultConfig: T;
  private readonly schema?: z.ZodType<T>;
  private readonly logger: NonNullable<ConfigManagerOptions<T>['logger']>;
  private currentConfig: T;

  constructor(options: ConfigManagerOptions<T>) {
    this.filePath = path.resolve(options.filePath);
    this.defaultConfig = options.defaultConfig;
    this.schema = options.schema;
    this.logger = options.logger || console;
    this.currentConfig = this.loadSync();
  }

  /**
   * Retrieves the currently loaded configuration.
   */
  public get(): T {
    return this.currentConfig;
  }

  /**
   * Sets the local configuration value. Does not persist to disk.
   * Use save() or saveSync() to persist.
   */
  public set(config: T): void {
    if (this.schema) {
      const result = this.schema.safeParse(config);
      if (!result.success) {
        throw new Error(`Invalid configuration: ${result.error.message}`);
      }
      this.currentConfig = result.data;
    } else {
      this.currentConfig = config;
    }
  }

  /**
   * Loads configuration from file synchronously.
   * Falls back to default if file is missing, empty, or corrupted.
   */
  public loadSync(): T {
    if (!fs.existsSync(this.filePath)) {
      this.logger.info(`[ConfigManager] Config file not found. Initializing default config at: ${this.filePath}`);
      try {
        this.saveSync(this.defaultConfig);
      } catch (err: any) {
        this.logger.error(`[ConfigManager] Failed to write initial default config: ${err.message}`);
      }
      this.currentConfig = { ...this.defaultConfig };
      return this.currentConfig;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      if (!content.trim()) {
        throw new Error('Config file is empty');
      }

      const parsed = JSON.parse(content);

      if (this.schema) {
        const result = this.schema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Schema validation failed: ${result.error.message}`);
        }
        this.currentConfig = result.data;
      } else {
        this.currentConfig = parsed as T;
      }

      return this.currentConfig;
    } catch (error: any) {
      this.logger.warn(
        `[ConfigManager] Failed to load/parse configuration at ${this.filePath}. ` +
        `Error: ${error.message}. Falling back to default configuration.`
      );
      this.currentConfig = { ...this.defaultConfig };
      return this.currentConfig;
    }
  }

  /**
   * Loads configuration from file asynchronously.
   * Falls back to default if file is missing, empty, or corrupted.
   */
  public async load(): Promise<T> {
    try {
      const exists = await fs.promises.access(this.filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        this.logger.info(`[ConfigManager] Config file not found. Initializing default config at: ${this.filePath}`);
        try {
          await this.save(this.defaultConfig);
        } catch (err: any) {
          this.logger.error(`[ConfigManager] Failed to write initial default config: ${err.message}`);
        }
        this.currentConfig = { ...this.defaultConfig };
        return this.currentConfig;
      }

      const content = await fs.promises.readFile(this.filePath, 'utf8');
      if (!content.trim()) {
        throw new Error('Config file is empty');
      }

      const parsed = JSON.parse(content);

      if (this.schema) {
        const result = this.schema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Schema validation failed: ${result.error.message}`);
        }
        this.currentConfig = result.data;
      } else {
        this.currentConfig = parsed as T;
      }

      return this.currentConfig;
    } catch (error: any) {
      this.logger.warn(
        `[ConfigManager] Failed to load/parse configuration at ${this.filePath}. ` +
        `Error: ${error.message}. Falling back to default configuration.`
      );
      this.currentConfig = { ...this.defaultConfig };
      return this.currentConfig;
    }
  }

  /**
   * Persists configuration synchronously using atomic write.
   */
  public saveSync(config: T): void {
    let configToSave = config;
    if (this.schema) {
      const result = this.schema.safeParse(config);
      if (!result.success) {
        throw new Error(`Cannot save invalid configuration: ${result.error.message}`);
      }
      configToSave = result.data;
    }

    const content = JSON.stringify(configToSave, null, 2);
    AtomicWriter.writeSync(this.filePath, content);
    this.currentConfig = configToSave;
  }

  /**
   * Persists configuration asynchronously using atomic write.
   */
  public async save(config: T): Promise<void> {
    let configToSave = config;
    if (this.schema) {
      const result = this.schema.safeParse(config);
      if (!result.success) {
        throw new Error(`Cannot save invalid configuration: ${result.error.message}`);
      }
      configToSave = result.data;
    }

    const content = JSON.stringify(configToSave, null, 2);
    await AtomicWriter.write(this.filePath, content);
    this.currentConfig = configToSave;
  }
}
