import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Единая форма ошибки для всех ответов API (camelCase, без snake_case). */
interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

/**
 * Глобальный фильтр исключений. Приводит любую ошибку (HttpException и
 * непредвиденные) к единому JSON-контракту. 5xx логируются со стеком,
 * но наружу не отдаётся внутренняя информация — клиент видит общее сообщение.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const { message, error } = this.describe(exception, status);

    // 5xx — серверные ошибки: логируем со стеком. status — number (getStatus()),
    // поэтому сравниваем с числом, а не с enum HttpStatus.
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private describe(
    exception: unknown,
    status: number,
  ): { message: string | string[]; error: string } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { message: res, error: exception.name };
      }
      const obj = res as { message?: string | string[]; error?: string };
      return {
        message: obj.message ?? exception.message,
        error: obj.error ?? exception.name,
      };
    }

    // Непредвиденная ошибка — наружу только общий текст (без утечки деталей).
    return {
      message: status >= 500 ? 'Internal server error' : 'Error',
      error: 'InternalServerError',
    };
  }
}
