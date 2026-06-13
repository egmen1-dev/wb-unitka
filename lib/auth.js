import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { isAdminPhone } from './admins.js';

const JWT_COOKIE = 'auth_token';
const TOKEN_TTL = '30d';

function getSecret() {
  const secret =
    process.env.JWT_SECRET ||
    process.env.Savenumbers_SUPABASE_JWT_SECRET ||
    Object.entries(process.env).find(([key]) => key.endsWith('_SUPABASE_JWT_SECRET'))?.[1] ||
    'dev-secret-change-me';
  return new TextEncoder().encode(secret);
}

export function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith('7')) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  return `+${digits}`;
}

export function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  return /^\+7\d{10}$/.test(normalized);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createToken(user) {
  return new SignJWT({
    sub: String(user.id),
    phone: user.phone,
    name: user.name,
    isAdmin: Boolean(user.is_admin || user.isAdmin || isAdminPhone(user.phone)),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());
}

export async function verifyToken(token) {
  if (!token) return null;
  const { payload } = await jwtVerify(token, getSecret());
  return {
    id: Number(payload.sub),
    phone: payload.phone,
    name: payload.name,
    isAdmin: Boolean(payload.isAdmin),
  };
}

export function getTokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${JWT_COOKIE}=([^;]+)`));
  return match?.[1] || null;
}

export function buildAuthCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${JWT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`;
}

export function clearAuthCookie() {
  return `${JWT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  return verifyToken(token);
}
