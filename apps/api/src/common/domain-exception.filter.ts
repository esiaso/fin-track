import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DomainError, fromDbError } from './errors';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(
        typeof exception.getResponse() === 'object' ? exception.getResponse() : { message: exception.message },
      );
      return;
    }
    const domain = exception instanceof DomainError ? exception : fromDbError(exception);
    if (domain) {
      res.status(domain.httpStatus).json({ code: domain.code, message: domain.message, details: domain.details });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ code: 'INTERNAL', message: 'Internal error' });
  }
}
