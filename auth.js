// Autenticacion y control de acceso por roles para Titan Agent.
// Usuarios en users.json (gitignorado, nunca en el repo). Contrasenas iniciales
// SIEMPRE por entorno (ADMIN_PASSWORD / LOCAL_PASSWORD en env.cmd) o generadas
// al azar en el primer arranque -- nunca hardcodeadas: este repositorio es publico.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'users.json');
const SECRET_FILE = path.join(__dirname, 'session-secret.txt');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

// --- Rutas y permisos por rol -------------------------------------------
// 'administrador': todos los modelos (locales + nube) y herramientas sensibles
//                  (SSH exec, terminal, guardar conexiones, reiniciar Ollama/GPU).
// 'usuario-l':     solo modelos locales de Ollama; sin exec/SSH/terminal/restart.
const ROLES = ['administrador', 'usuario-l'];

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
}

function loadOrCreateSecret() {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

const SESSION_SECRET = loadOrCreateSecret();

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

/** Crea users.json en el primer arranque si no existe. Nunca pisa uno ya presente
 *  (para no resetear contrasenas que el usuario ya cambio). */
function ensureUsers() {
  let users = loadUsers();
  if (users) return users;

  const adminUser = process.env.ADMIN_USER || 'admin';
  const localUser = process.env.LOCAL_USER || 'usuario-l';
  const adminPass = process.env.ADMIN_PASSWORD || randomPassword();
  const localPass = process.env.LOCAL_PASSWORD || randomPassword();

  users = {
    [adminUser]: { passwordHash: bcrypt.hashSync(adminPass, 10), role: 'administrador' },
    [localUser]: { passwordHash: bcrypt.hashSync(localPass, 10), role: 'usuario-l' },
  };
  saveUsers(users);

  console.log('\n=== USUARIOS CREADOS (primer arranque) ===');
  if (!process.env.ADMIN_PASSWORD) console.log(`  ${adminUser} / ${adminPass}  (administrador -- guarda esta contrasena, no se vuelve a mostrar)`);
  else console.log(`  ${adminUser}  (administrador, contrasena desde ADMIN_PASSWORD)`);
  if (!process.env.LOCAL_PASSWORD) console.log(`  ${localUser} / ${localPass}  (usuario-l -- guarda esta contrasena, no se vuelve a mostrar)`);
  else console.log(`  ${localUser}  (usuario-l, contrasena desde LOCAL_PASSWORD)`);
  console.log('===========================================\n');

  return users;
}

const sessions = new Map(); // token -> { username, role, expires }

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expires < now) sessions.delete(token);
  }
}
setInterval(cleanExpiredSessions, 10 * 60 * 1000).unref();

function createSession(username, role) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, role, expires: Date.now() + SESSION_TTL_MS });
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex').slice(0, 16);
  return `${token}.${sig}`;
}

function verifySessionCookie(cookieVal) {
  if (!cookieVal || !cookieVal.includes('.')) return null;
  const [token, sig] = cookieVal.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex').slice(0, 16);
  if (sig !== expected) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) return null;
  return { token, ...s };
}

function destroySession(cookieVal) {
  if (!cookieVal || !cookieVal.includes('.')) return;
  const [token] = cookieVal.split('.');
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, value) {
  res.setHeader('Set-Cookie', `titan_session=${value}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'titan_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

/** Middleware: exige sesion valida. Cuelga req.user = { username, role }. */
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const session = verifySessionCookie(cookies.titan_session);
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  req.user = { username: session.username, role: session.role };
  next();
}

/** Middleware: exige ademas rol administrador. */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'administrador') {
    return res.status(403).json({ error: 'Requiere rol administrador' });
  }
  next();
}

async function login(username, password) {
  const users = loadUsers() || {};
  const u = users[username];
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  return { username, role: u.role };
}

// --- Gestion de usuarios (panel de administrador) -------------------------

function listUsers() {
  const users = loadUsers() || {};
  return Object.keys(users).map((username) => ({ username, role: users[username].role }));
}

function createUser(username, password, role) {
  if (!username || !password) throw new Error('Username y password requeridos');
  if (!ROLES.includes(role)) throw new Error('Rol no valido');
  const users = loadUsers() || {};
  if (users[username]) throw new Error('Ya existe ese usuario');
  users[username] = { passwordHash: bcrypt.hashSync(password, 10), role };
  saveUsers(users);
  return { username, role };
}

function setUserRole(username, role) {
  if (!ROLES.includes(role)) throw new Error('Rol no valido');
  const users = loadUsers() || {};
  if (!users[username]) throw new Error('Usuario no existe');
  users[username].role = role;
  saveUsers(users);
}

function deleteUser(username) {
  const users = loadUsers() || {};
  if (!users[username]) throw new Error('Usuario no existe');
  const adminCount = Object.values(users).filter((u) => u.role === 'administrador').length;
  if (users[username].role === 'administrador' && adminCount <= 1) {
    throw new Error('No se puede borrar el ultimo administrador');
  }
  delete users[username];
  saveUsers(users);
}

module.exports = {
  ROLES,
  ensureUsers,
  login,
  listUsers,
  createUser,
  setUserRole,
  deleteUser,
  createSession,
  destroySession,
  verifySessionCookie,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
};
