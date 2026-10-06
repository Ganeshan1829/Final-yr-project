import { ZodError } from 'zod';
export function errorHandler(err, _req, res, _next) {
    // Handle Zod validation errors
    if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
        }));
        return res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: err.errors[0]?.message || 'Input validation failed',
                details,
            },
        });
    }
    // Handle Multer upload errors
    if (err.name === 'MulterError') {
        return res.status(400).json({
            error: {
                code: 'UPLOAD_ERROR',
                message: err.message,
            },
        });
    }
    // Handle explicit status codes or bad request errors
    const status = err.statusCode || (err.message && (err.message.includes('not found') ? 404 :
        err.message.includes('required') ||
            err.message.includes('invalid') ||
            err.message.includes('Invalid') ||
            err.message.includes('outside') ||
            err.message.includes('must fall') ||
            err.message.includes('exceeds') ||
            err.message.includes('Unknown') ||
            err.message.includes('Cannot') ||
            err.message.includes('does not exist')
            ? 400
            : 500)) || 500;
    const code = err.code || (status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
    res.status(status).json({
        error: {
            code,
            message: err.message || 'An unexpected error occurred',
            ...(err.details ? { details: err.details } : {}),
        },
    });
}
