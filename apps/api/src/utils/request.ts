import type { Request } from 'express';

/**
 * Get a parameter from request params safely
 */
export function getParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

/**
 * Get a query parameter safely
 */
export function getQuery(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Get a query parameter as a number
 */
export function getQueryInt(req: Request, name: string): number | undefined {
  const value = getQuery(req, name);
  if (value === undefined) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}
