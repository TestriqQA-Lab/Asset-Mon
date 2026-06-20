import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { message: body, statusCode: status } : body);
      return;
    }

    if (exception?.type === 'entity.too.large' || exception?.statusCode === 413) {
      res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: 413, error: 'Payload Too Large', message: 'Request body exceeds limit',
      });
      return;
    }
    if (exception?.type === 'entity.parse.failed' || (exception instanceof SyntaxError && /JSON/i.test(exception.message || ''))) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400, error: 'Bad Request', message: 'Malformed JSON',
      });
      return;
    }

    if (exception?.code === '22021' || /invalid byte sequence|null bytes/i.test(exception?.message || '')) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400, error: 'Bad Request', message: 'Invalid characters in input',
      });
      return;
    }

    // MulterError or any errors thrown from fileFilter -> 400
    const msg: string = String(exception?.message || '');
    if (
      exception?.name === 'MulterError' ||
      msg.toLowerCase().includes('multer') ||
      msg.toLowerCase().includes('image files allowed') ||
      msg.toLowerCase().includes('only ') && msg.toLowerCase().includes(' allowed')
    ) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400, error: 'Bad Request', message: msg || 'Upload error',
      });
      return;
    }

    if (exception?.code === 'P2002') {
      // Prisma unique constraint
      res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Unique constraint failed',
        target: exception.meta?.target,
      });
      return;
    }

    if (exception?.code === 'P2025') {
      res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Record not found',
      });
      return;
    }

    if (exception?.code === 'P2003' || exception?.code === 'P2016' || exception?.code === 'P2014') {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Invalid reference',
      });
      return;
    }

    if (typeof exception?.code === 'string' && exception.code.startsWith('P2')) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Database operation failed',
      });
      return;
    }

    const requestId = (req as any)?.id;
    this.log.error(`[${requestId || '-'}] [${req.method} ${req.url}] ${exception?.message || exception}`, exception?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Unexpected error',
      ...(requestId ? { requestId } : {}),
    });
  }
}
