import { PrismaService } from './prisma.service';

describe('PrismaService connection retries', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries transient failures before connecting', async () => {
    jest.useFakeTimers();
    const prisma = new PrismaService();
    const connect = jest.spyOn(prisma, '$connect')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce();
    const initialization = prisma.onModuleInit();

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);

    await expect(initialization).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('fails clearly after the configured retry attempts', async () => {
    jest.useFakeTimers();
    const prisma = new PrismaService();
    const connect = jest.spyOn(prisma, '$connect')
      .mockRejectedValue(new Error('connection details must not be exposed'));
    const initialization = prisma.onModuleInit();
    const rejection = expect(initialization).rejects.toThrow(
      'Unable to connect to the database after 4 attempts.',
    );

    await jest.runAllTimersAsync();
    await rejection;
    expect(connect).toHaveBeenCalledTimes(4);
  });
});
