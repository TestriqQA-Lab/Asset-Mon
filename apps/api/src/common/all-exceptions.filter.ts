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
      // A foreign-key violation happens in two opposite directions, and "Invalid
      // reference" described neither:
      //   · on a delete  — something else still points at the row being removed
      //   · on write     — the row being saved points at something that isn't there
      // The HTTP method tells them apart. Prisma reports the constraint as
      // "Table_column_fkey", so the column names the offending field on a write and the
      // related table names the blocker on a delete.
      // Prisma reports e.g. `Asset_categoryId_fkey (index)` — drop the trailing
      // qualifier and the _fkey suffix before splitting, or the last segment is noise.
      const raw = String(exception?.meta?.field_name ?? exception?.meta?.target ?? '')
        .replace(/\s*\(.*\)\s*$/, '')
        .replace(/_fkey$/, '');
      const parts = raw.split(/[_.]/).filter(Boolean);
      const table = parts[0] || '';
      const column = parts.length > 1 ? parts[parts.length - 1] : '';
      const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const isDelete = String(req?.method || '').toUpperCase() === 'DELETE';

      let message: string;
      if (isDelete) {
        message = table
          ? `Can't delete this while ${spaced(table)} records still refer to it. Remove those first.`
          : 'Can\'t delete this while other records still refer to it.';
      } else {
        message = column
          ? `The ${spaced(column).replace(/ id$/, '')} you selected no longer exists. Pick another and try again.`
          : 'One of the linked items you selected no longer exists.';
      }
      res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, error: 'Bad Request', message });
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
