import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ConfigManager, AtomicWriter } from '../config-manager';

// Define a sample config schema for testing
const AppConfigSchema = z.object({
  theme: z.enum(['light', 'dark']),
  port: z.number().int().min(1024).max(65535),
  features: z.object({
    enableChat: z.boolean(),
    enableHistory: z.boolean(),
  }),
});

type AppConfig = z.infer<typeof AppConfigSchema>;

const defaultConfig: AppConfig = {
  theme: 'light',
  port: 9003,
  features: {
    enableChat: true,
    enableHistory: true,
  },
};

describe('ConfigManager', () => {
  const testDir = path.join(__dirname, 'temp-test-configs');
  const configPath = path.join(testDir, 'config.json');

  // Helper to log errors or warnings without polluting console during tests
  const silentLogger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    // Ensure clean state before each test
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    // Clean up any temp files that might be left
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  describe('Initialization and Loading', () => {
    it('should initialize with default config if file does not exist', () => {
      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      expect(manager.get()).toEqual(defaultConfig);
      expect(fs.existsSync(configPath)).toBe(true);
      
      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(savedContent).toEqual(defaultConfig);
    });

    it('should load existing valid configuration file', () => {
      fs.mkdirSync(testDir, { recursive: true });
      const customConfig: AppConfig = {
        theme: 'dark',
        port: 8080,
        features: {
          enableChat: false,
          enableHistory: true,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(customConfig), 'utf8');

      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      expect(manager.get()).toEqual(customConfig);
    });

    it('should fall back to defaults and warn on corrupted JSON file', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(configPath, '{ invalid json: true ', 'utf8');

      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      expect(manager.get()).toEqual(defaultConfig);
      expect(silentLogger.warn).toHaveBeenCalled();
    });

    it('should fall back to defaults and warn on empty configuration file', () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(configPath, '', 'utf8');

      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      expect(manager.get()).toEqual(defaultConfig);
      expect(silentLogger.warn).toHaveBeenCalled();
    });

    it('should fall back to defaults and warn if schema validation fails', () => {
      fs.mkdirSync(testDir, { recursive: true });
      const badConfig = {
        theme: 'blue', // Invalid option, schema only accepts light/dark
        port: 999999, // Too large
        features: {
          enableChat: 'yes', // Should be boolean
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(badConfig), 'utf8');

      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      expect(manager.get()).toEqual(defaultConfig);
      expect(silentLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Saving Configurations', () => {
    it('should save updates synchronously using atomic write', () => {
      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      const updated: AppConfig = {
        theme: 'dark',
        port: 3000,
        features: {
          enableChat: true,
          enableHistory: false,
        },
      };

      manager.saveSync(updated);

      expect(manager.get()).toEqual(updated);
      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(savedContent).toEqual(updated);
    });

    it('should save updates asynchronously using atomic write', async () => {
      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      const updated: AppConfig = {
        theme: 'dark',
        port: 4000,
        features: {
          enableChat: false,
          enableHistory: false,
        },
      };

      await manager.save(updated);

      expect(manager.get()).toEqual(updated);
      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(savedContent).toEqual(updated);
    });

    it('should reject and throw error when saving config that violates schema', () => {
      const manager = new ConfigManager<AppConfig>({
        filePath: configPath,
        defaultConfig,
        schema: AppConfigSchema,
        logger: silentLogger,
      });

      const invalidConfig = {
        theme: 'invalid-theme',
        port: 80,
      } as any;

      expect(() => manager.saveSync(invalidConfig)).toThrow();
    });
  });

  describe('AtomicWriter Safety', () => {
    it('should write atomically and not leave temporary file behind on success', async () => {
      fs.mkdirSync(testDir, { recursive: true });
      const data = JSON.stringify({ test: 'atomic' });
      
      await AtomicWriter.write(configPath, data);

      expect(fs.readFileSync(configPath, 'utf8')).toBe(data);
      
      // Verify no temporary files exist in testDir
      const files = fs.readdirSync(testDir);
      const tempFiles = files.filter(f => f.includes('.tmp'));
      expect(tempFiles.length).toBe(0);
    });

    it('should cleanup temporary files on write failure', async () => {
      // Mock fs.promises.rename to throw error to simulate renaming error
      const originalRename = fs.promises.rename;
      fs.promises.rename = jest.fn().mockRejectedValue(new Error('Rename error'));

      fs.mkdirSync(testDir, { recursive: true });
      const data = JSON.stringify({ test: 'failure' });

      await expect(AtomicWriter.write(configPath, data)).rejects.toThrow('Rename error');

      // Verify no temporary files are left in the directory
      const files = fs.readdirSync(testDir);
      const tempFiles = files.filter(f => f.includes('.tmp'));
      expect(tempFiles.length).toBe(0);

      // Restore original implementation
      fs.promises.rename = originalRename;
    });
  });
});
