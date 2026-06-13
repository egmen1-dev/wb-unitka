import { normalizePhone } from './auth.js';

export const ADMIN_USERS = [
  { phone: '+79043803051', name: 'Максим' },
];

const ADMIN_PHONES = new Set(ADMIN_USERS.map((admin) => normalizePhone(admin.phone)));

export function isAdminPhone(phone) {
  return ADMIN_PHONES.has(normalizePhone(phone));
}

export function isAdminUser(user) {
  if (!user) return false;
  return Boolean(user.is_admin || user.isAdmin || isAdminPhone(user.phone));
}
