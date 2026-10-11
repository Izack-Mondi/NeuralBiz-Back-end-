import { HealthService } from './health.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it.each([
    [{ status: 'ok' }, 200],
    [{ status: 'error' }, 503],
  ])('uses the health result to set the HTTP status', async (result, status) => {
    const healthService = {
      check: jest.fn().mockResolvedValue(result),
    } as unknown as HealthService;
    const controller = new HealthController(healthService);
    const response = { status: jest.fn() };

    await expect(controller.check(response as never)).resolves.toEqual(result);
    expect(response.status).toHaveBeenCalledWith(status);
  });
});
