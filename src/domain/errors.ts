/** Typed errors mapped to HTTP responses once, at the route boundary. */
export class ServiceError extends Error {
	readonly code: string;
	readonly statusCode: number;

	constructor(code: string, message: string, statusCode: number) {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.statusCode = statusCode;
	}
}

export const invalidRequest = (message: string): ServiceError =>
	new ServiceError('invalid-request', message, 400);

export const unauthorized = (message = 'Authentication required'): ServiceError =>
	new ServiceError('unauthorized', message, 401);

export const forbidden = (message = 'Permission denied'): ServiceError =>
	new ServiceError('forbidden', message, 403);

export const notFound = (message = 'Not found'): ServiceError =>
	new ServiceError('not-found', message, 404);

export const unavailable = (message = 'Service unavailable'): ServiceError =>
	new ServiceError('unavailable', message, 503);
