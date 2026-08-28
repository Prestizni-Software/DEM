import { jest } from '@jest/globals';
import { AutoUpdateClientManager } from '../AutoUpdateClientManagerClass.js';
import { EventEmitter } from 'eventemitter3';
import { globalCache, LoggersType, MongoId } from '../CommonTypes.js';

class MockClientClass {
  public _id: MongoId = 'test-id';
  public name: string = 'test';
  constructor(public data: any) {}
  public async isPreLoadedAsync() { return true; }
  public async loadMissingReferences() { return true; }
  public generateSettersAndGetters() {}
}

describe('Memory Leak Verification', () => {
  let loggers: LoggersType;

  beforeEach(() => {
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test('Global cache and manager objects do not leak deleted entries', async () => {
    const mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    const manager = new AutoUpdateClientManager(
      MockClientClass as any,
      'Mock',
      mockSocket as any,
      loggers,
      {},
      new EventEmitter(),
      {
        new: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        progress: jest.fn(),
      },
    );

    const testId = 'mem-leak-test-id-123';
    const obj = new MockClientClass({ _id: testId, name: 'temp' });
    (manager as any).objects_[testId] = obj;
    globalCache.objects[testId] = {
      className: 'Mock',
      object: obj as any,
    };

    expect(manager.getObject(testId)).toBeDefined();
    expect(globalCache.objects[testId]).toBeDefined();

    await manager.deleteObject(testId);

    expect(manager.getObject(testId)).toBeUndefined();
    expect(globalCache.objects[testId]).toBeUndefined();
  });
});
