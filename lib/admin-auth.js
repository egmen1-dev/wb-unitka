import { getUserFromRequest } from './auth.js';
import { isAdminPhone, isAdminUser } from './admins.js';
import { getUserById, getSql, initDb } from './db.js';

async function ensureUserAdminFlag(user) {
  if (!user?.id || user.is_admin || !isAdminPhone(user.phone)) {
    return user;
  }

  const db = getSql();
  await db`
    UPDATE users
    SET is_admin = TRUE, updated_at = NOW()
    WHERE id = ${user.id}
  `;

  return { ...user, is_admin: true };
}

export async function requireAdmin(req) {
  const session = await getUserFromRequest(req);

  if (session?.id) {
    await initDb();
    const user = await ensureUserAdminFlag(await getUserById(session.id));

    if (isAdminUser(user)) {
      return user;
    }

    if (isAdminPhone(session.phone)) {
      return (
        user || {
          id: session.id,
          name: session.name,
          phone: session.phone,
          is_admin: true,
        }
      );
    }
  }

  const adminSecret = process.env.ADMIN_SECRET?.trim();
  if (adminSecret && req.headers.authorization === `Bearer ${adminSecret}`) {
    return { id: 0, name: 'API Admin', phone: '', is_admin: true };
  }

  return null;
}
