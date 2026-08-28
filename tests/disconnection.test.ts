import { jest } from '@jest/globals';
import { AutoUpdateClientManager } from '../AutoUpdateClientManagerClass.js';
import { EventEmitter } from 'eventemitter3';
import { LoggersType, MongoId } from '../CommonTypes.js';

class MockClientClass {
  public _id: MongoId = 'test-id';
  public name: string = 'test';
  constructor(public data: any) {}
  public async isPreLoadedAsync() { return true; }
  public async loadMissingReferences() { return true; }
  public generateSettersAndGetters() {}
}

describe('Disconnection and Reconnection Handling', () => {
  let loggers: LoggersType;

  beforeEach(() => {
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test('AutoUpdateClientManager handles socket disconnection and reconnection listeners', () => {
    const registeredHandlers: Record<string, Function> = {};
    const mockSocket = {
      on: jest.fn((event: string, handler: Function) => {
        registeredHandlers[event] = handler;
      }),
      off: jest.fn(),
      emit: jest.fn(),
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

    expect(mockSocket.on).toHaveBeenCalledWith('reconnect', expect.any(Function));
    expect(typeof registeredHandlers['reconnect']).toBe('function');
  });

  test('Manager cleanups cache and state on close', () => {
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

    manager.close();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
