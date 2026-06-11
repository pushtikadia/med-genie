import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { z } from 'zod';
import { ConfigManager, AtomicWriter } from '../src/lib/config-manager';

// Define a simple schema for verification
const TestSchema = z.object({
  theme: z.enum(['light', 'dark']),
  port: z.number().int().min(1000),
  debug: z.boolean(),
});

type TestConfig = z.infer<typeof TestSchema>;

const defaultConfig: TestConfig = {
  theme: 'light',
  port: 9003,
  debug: false,
};

const testDir = path.join(__dirname, 'temp-test-configs');
const configPath = path.join(testDir, 'config.json');

// Mock Logger
const mockLogger = {
  warnCalled: false,
  warnMessage: '',
  warn(msg: string) {
    this.warnCalled = true;
    this.warnMessage = msg;
  },
  info() {},
  error() {},
};

function cleanup() {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      fs.unlinkSync(path.join(testDir, file));
    }
    fs.rmdirSync(testDir);
  }
}

async function runTests() {
  console.log('🧪 Starting ConfigManager Validation Tests...');

  // --- Test 1: Initialize with defaults ---
  cleanup();
  mockLogger.warnCalled = false;
  
  let manager = new ConfigManager<TestConfig>({
    filePath: configPath,
    defaultConfig,
    schema: TestSchema,
    logger: mockLogger,
  });

  assert.deepStrictEqual(manager.get(), defaultConfig, 'Should initialize with default config');
  assert.ok(fs.existsSync(configPath), 'Config file should be created');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), defaultConfig, 'Saved file content should match defaults');
  console.log('✅ Test 1: Initialize and create default file passed.');

  // --- Test 2: Load existing valid config ---
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });
  const customConfig: TestConfig = { theme: 'dark', port: 8080, debug: true };
  fs.writeFileSync(configPath, JSON.stringify(customConfig), 'utf8');

  manager = new ConfigManager<TestConfig>({
    filePath: configPath,
    defaultConfig,
    schema: TestSchema,
    logger: mockLogger,
  });

  assert.deepStrictEqual(manager.get(), customConfig, 'Should load existing custom configuration');
  console.log('✅ Test 2: Load valid configuration passed.');

  // --- Test 3: Fallback and warn on corrupted file ---
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(configPath, '{ invalid json string ', 'utf8');
  mockLogger.warnCalled = false;

  manager = new ConfigManager<TestConfig>({
    filePath: configPath,
    defaultConfig,
    schema: TestSchema,
    logger: mockLogger,
  });

  assert.deepStrictEqual(manager.get(), defaultConfig, 'Should fallback to default on corruption');
  assert.ok(mockLogger.warnCalled, 'Warning should be logged for corruption');
  console.log('✅ Test 3: Fallback and warn on corruption passed.');

  // --- Test 4: Save updates atomically ---
  cleanup();
  manager = new ConfigManager<TestConfig>({
    filePath: configPath,
    defaultConfig,
    schema: TestSchema,
    logger: mockLogger,
  });

  const updatedConfig: TestConfig = { theme: 'dark', port: 5000, debug: true };
  await manager.save(updatedConfig);

  assert.deepStrictEqual(manager.get(), updatedConfig, 'InMemory config should be updated');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), updatedConfig, 'File content should match updated configuration');
  
  // Verify no temp files left
  const files = fs.readdirSync(testDir);
  const tempFiles = files.filter(f => f.includes('.tmp'));
  assert.strictEqual(tempFiles.length, 0, 'No temp files should be left behind');
  console.log('✅ Test 4: Atomic save and cleanup passed.');

  // --- Test 5: Fallback and warn on schema validation failure ---
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });
  const badConfig = { theme: 'blue', port: 99, debug: 'yes' }; // invalid values
  fs.writeFileSync(configPath, JSON.stringify(badConfig), 'utf8');
  mockLogger.warnCalled = false;

  manager = new ConfigManager<TestConfig>({
    filePath: configPath,
    defaultConfig,
    schema: TestSchema,
    logger: mockLogger,
  });

  assert.deepStrictEqual(manager.get(), defaultConfig, 'Should fallback to default on invalid schema loaded from file');
  assert.ok(mockLogger.warnCalled, 'Warning should be logged for schema validation failure');
  console.log('✅ Test 5: Schema validation fallback passed.');

  cleanup();
  console.log('\n🎉 All ConfigManager tests completed successfully!');
}

runTests().catch(err => {
  console.error('❌ Verification tests failed:', err);
  cleanup();
  process.exit(1);
});
