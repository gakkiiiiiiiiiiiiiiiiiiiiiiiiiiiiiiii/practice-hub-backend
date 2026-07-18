import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { OperationLogInterceptor } from './operation-log.interceptor';

describe('OperationLogInterceptor', () => {
  const createContext = (request: any, response: any = { statusCode: 200 }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }) as ExecutionContext;

  const createHandler = (observable = of({ ok: true })) =>
    ({ handle: () => observable }) as CallHandler;

  it('records successful admin mutations and redacts secrets', async () => {
    const repository = { save: jest.fn().mockResolvedValue({}) };
    const interceptor = new OperationLogInterceptor(repository as any);
    const request = {
      method: 'PUT',
      originalUrl: '/api/admin/settings/course-cover?source=test',
      body: { activeTemplateId: 'default', password: 'secret' },
      params: {},
      query: { source: 'test' },
      user: { adminId: 7 },
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request), createHandler()),
    );
    await Promise.resolve();

    expect(repository.save).toHaveBeenCalledTimes(1);
    const log = repository.save.mock.calls[0][0];
    const content = JSON.parse(log.content);
    expect(log).toMatchObject({
      admin_id: 7,
      module: 'settings',
      action: 'update',
      target_id: null,
      ip: '1.2.3.4',
    });
    expect(content).toMatchObject({
      method: 'PUT',
      path: '/api/admin/settings/course-cover',
      statusCode: 200,
      body: { activeTemplateId: 'default', password: '[REDACTED]' },
    });
  });

  it('records failed admin mutations', async () => {
    const repository = { save: jest.fn().mockResolvedValue({}) };
    const interceptor = new OperationLogInterceptor(repository as any);
    const request = {
      method: 'POST',
      url: '/admin/courses',
      body: {},
      params: {},
      query: {},
      user: { adminId: 9 },
      headers: {},
      ip: '127.0.0.1',
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          createContext(request, { statusCode: 201 }),
          createHandler(throwError(() => new BadRequestException('参数错误'))),
        ),
      ),
    ).rejects.toThrow('参数错误');
    await Promise.resolve();

    const content = JSON.parse(repository.save.mock.calls[0][0].content);
    expect(content.statusCode).toBe(400);
    expect(content.errorMessage).toBe('参数错误');
  });

  it('ignores reads and non-admin mutations', async () => {
    const repository = { save: jest.fn().mockResolvedValue({}) };
    const interceptor = new OperationLogInterceptor(repository as any);

    await lastValueFrom(
      interceptor.intercept(
        createContext({
          method: 'GET',
          url: '/api/admin/settings/course-cover',
        }),
        createHandler(),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        createContext({ method: 'POST', url: '/api/app/feedback' }),
        createHandler(),
      ),
    );

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('records admin login attempts without storing the password', async () => {
    const repository = { save: jest.fn().mockResolvedValue({}) };
    const interceptor = new OperationLogInterceptor(repository as any);
    const request = {
      method: 'POST',
      url: '/api/auth/admin/login',
      body: { username: 'admin', password: 'plain-text-password' },
      params: {},
      query: {},
      headers: {},
      ip: '127.0.0.1',
    };

    await lastValueFrom(
      interceptor.intercept(
        createContext(request, { statusCode: 201 }),
        createHandler(),
      ),
    );
    await Promise.resolve();

    const log = repository.save.mock.calls[0][0];
    const content = JSON.parse(log.content);
    expect(log).toMatchObject({ module: 'auth', action: 'login', admin_id: 0 });
    expect(content.body).toEqual({ username: 'admin', password: '[REDACTED]' });
  });

  it('does not duplicate logs when a controller also uses the interceptor', async () => {
    const repository = { save: jest.fn().mockResolvedValue({}) };
    const interceptor = new OperationLogInterceptor(repository as any);
    const request = {
      method: 'DELETE',
      url: '/api/admin/courses/12',
      body: {},
      params: { id: '12' },
      query: {},
      user: { adminId: 3 },
      headers: {},
      ip: '127.0.0.1',
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request), createHandler()),
    );
    await lastValueFrom(
      interceptor.intercept(createContext(request), createHandler()),
    );
    await Promise.resolve();

    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
