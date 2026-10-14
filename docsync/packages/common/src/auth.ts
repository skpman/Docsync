import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface TokenPayload {
  sub: string; // user id
  email: string;
  name: string;
  color: string;
}

export function signToken(payload: TokenPayload, expiresIn: jwt.SignOptions['expiresIn'] = '7d'): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === 'string' || !decoded.sub) return null;
    return decoded as unknown as TokenPayload;
  } catch {
    return null;
  }
}
