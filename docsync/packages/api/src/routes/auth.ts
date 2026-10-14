import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query, signToken } from '@docsync/common';
import { HttpError, requireAuth } from '../http.js';

const COLORS = ['#e11d48', '#db2777', '#9333ea', '#4f46e5', '#0284c7', '#0d9488', '#16a34a', '#ca8a04', '#ea580c'];

interface UserRow {
  id: string;
  email: string;
  name: string;
  color: string;
  password_hash: string;
}

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, color: u.color });
const issue = (u: UserRow) => ({
  token: signToken({ sub: u.id, email: u.email, name: u.name, color: u.color }),
  user: publicUser(u),
});

const registerBody = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(200),
});

const loginBody = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { email, name, password } = registerBody.parse(req.body);
  const hash = await bcrypt.hash(password, 12);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, password_hash, color) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [email, name, hash, color],
  );
  if (!rows[0]) throw new HttpError(409, 'An account with that email already exists');
  res.status(201).json(issue(rows[0]));
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  const ok = rows[0] && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) throw new HttpError(401, 'Wrong email or password');
  res.json(issue(rows[0]));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.sub]);
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
  res.json({ user: publicUser(rows[0]) });
});
