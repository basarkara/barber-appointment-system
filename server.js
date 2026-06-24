const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const APPOINTMENT_RATE_LIMIT_WINDOW_MINUTES = Number(process.env.APPOINTMENT_RATE_LIMIT_WINDOW_MINUTES || 15);
const APPOINTMENT_RATE_LIMIT_MAX = Number(process.env.APPOINTMENT_RATE_LIMIT_MAX || 5);
const APPOINTMENT_MAX_ACTIVE_PER_IP = Number(process.env.APPOINTMENT_MAX_ACTIVE_PER_IP || 3);
const APPOINTMENT_MAX_ACTIVE_PER_CUSTOMER = Number(process.env.APPOINTMENT_MAX_ACTIVE_PER_CUSTOMER || 2);
const SESSION_SECRET = process.env.SESSION_SECRET || 'berbertakip-dev-secret-change-me';
const SESSION_COOKIE_NAME = 'berbertakip_session';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_HOURS || 12) * 60 * 60 * 1000;
const telegramBot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false }) : null;
const isTelegramEnabled = telegramBot && TELEGRAM_CHAT_ID;
const appointmentRateLimits = new Map();

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

console.log('Telegram config:', {
  tokenSet: Boolean(TELEGRAM_BOT_TOKEN),
  chatIdSet: Boolean(TELEGRAM_CHAT_ID),
  isTelegramEnabled
});

if (!isTelegramEnabled) {
  console.log('Telegram bildirimi devre dışı. Lütfen TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID ortam değişkenlerini ayarlayın.');
}

const adminAuth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'Berber Randevu Sistemi'
});

function getClientIp(req) {
  const value = req.ip || req.socket?.remoteAddress || 'unknown';
  return value.replace(/^::ffff:/, '');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index === -1) return cookies;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function signSession(shopId, expiresAt) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${shopId}.${expiresAt}`)
    .digest('hex');
}

function createSessionToken(shopId) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const signature = signSession(shopId, expiresAt);
  return Buffer.from(`${shopId}.${expiresAt}.${signature}`).toString('base64url');
}

function readSessionToken(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return null;

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [shopId, expiresAt, signature] = decoded.split('.');
    if (!shopId || !expiresAt || !signature) return null;
    if (Date.now() > Number(expiresAt)) return null;

    const expected = signSession(shopId, expiresAt);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    return Number(shopId);
  } catch {
    return null;
  }
}

function setSessionCookie(res, shopId) {
  const token = createSessionToken(shopId);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax'
  });
}

async function getAuthenticatedShop(req) {
  const shopId = readSessionToken(req);
  if (!shopId) return null;
  return db.getShopById(shopId);
}

function getAppointmentUrl(req, shop) {
  return `${req.protocol}://${req.get('host')}/randevu/${encodeURIComponent(shop.slug)}`;
}

async function barberAuth(req, res, next) {
  const shop = await getAuthenticatedShop(req);
  if (!shop) {
    return res.status(401).json({ error: 'Lütfen usta girişi yapın.' });
  }

  req.shop = shop;
  next();
}

async function getShopMasterOrNull(shopId, masterId) {
  const id = parseInt(masterId, 10);
  if (Number.isNaN(id)) return null;
  const master = await db.getMasterById(id);
  if (!master || Number(master.shopId) !== Number(shopId)) return null;
  return master;
}

async function appointmentBelongsToShop(appointment, shopId) {
  if (!appointment) return false;
  const master = await db.getMasterById(appointment.masterId);
  return Boolean(master && Number(master.shopId) === Number(shopId));
}

function isAdminRequest(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    return decoded === `${ADMIN_USER}:${ADMIN_PASS}`;
  } catch {
    return false;
  }
}

function checkAppointmentRateLimit(clientIp) {
  const now = Date.now();
  const windowMs = APPOINTMENT_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  const windowStart = now - windowMs;
  const current = appointmentRateLimits.get(clientIp) || [];
  const recent = current.filter((timestamp) => timestamp > windowStart);

  if (recent.length >= APPOINTMENT_RATE_LIMIT_MAX) {
    appointmentRateLimits.set(clientIp, recent);
    return false;
  }

  recent.push(now);
  appointmentRateLimits.set(clientIp, recent);
  return true;
}

function toComparableLocalTime(date) {
  return date.toISOString().slice(0, 19);
}

function formatAppointmentTimeForMessage(time) {
  const date = new Date(time);
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

async function sendTelegramNotification(appointment, masterName) {
  if (!isTelegramEnabled) {
    console.log('Telegram bildirimi devre dışı, bildirim gönderilmeyecek.');
    return;
  }

  const appointmentTime = formatAppointmentTimeForMessage(appointment.time);
  const message = `📅 Berber Randevu Oluşturuldu\n\n👤 Müşteri: ${appointment.firstName} ${appointment.lastName}\n✂️ Usta: ${masterName || 'Bilinmiyor'}\n⏰ Saat: ${appointmentTime}\n✂️ İşlem: ${appointment.service}`;

  try {
    await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message);
    console.log('Telegram bildirimi gönderildi:', appointmentTime, masterName);
  } catch (error) {
    console.error('Telegram gönderimi sırasında hata oluştu:', error.message || error);
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/barber-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  try {
    const shop = await db.verifyShopLogin(username, password);
    if (!shop) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    const masters = await db.getMasters(shop.id);
    setSessionCookie(res, shop.id);
    res.json({ shop, masters, appointmentUrl: getAppointmentUrl(req, shop) });
  } catch (error) {
    res.status(500).json({ error: 'Giriş yapılamadı.' });
  }
});

app.post('/api/barber-logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/barber-session', async (req, res) => {
  try {
    const shop = await getAuthenticatedShop(req);
    if (!shop) {
      return res.status(401).json({ error: 'Oturum bulunamadı.' });
    }

    const masters = await db.getMasters(shop.id);
    res.json({ shop, masters, appointmentUrl: getAppointmentUrl(req, shop) });
  } catch (error) {
    res.status(500).json({ error: 'Oturum bilgisi alınamadı.' });
  }
});

app.get('/api/barber-appointment-link', barberAuth, (req, res) => {
  res.json({ appointmentUrl: getAppointmentUrl(req, req.shop) });
});

app.get('/api/barber-appointment-qr', barberAuth, async (req, res) => {
  const appointmentUrl = getAppointmentUrl(req, req.shop);

  try {
    const qrDataUrl = await QRCode.toDataURL(appointmentUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({ appointmentUrl, qrDataUrl });
  } catch (error) {
    res.status(500).json({ error: 'QR kod oluşturulamadı.' });
  }
});

app.get('/api/barbers/:slug', async (req, res) => {
  try {
    const shop = await db.getShopBySlug(req.params.slug);
    if (!shop) {
      return res.status(404).json({ error: 'Berber bulunamadı.' });
    }

    const masters = await db.getMasters(shop.id);
    res.json({ id: shop.id, name: shop.name, slug: shop.slug, masters });
  } catch (error) {
    res.status(500).json({ error: 'Berber bilgisi alınamadı.' });
  }
});

app.post('/api/appointments', async (req, res) => {
  console.log('POST /api/appointments received', { body: req.body });

  const { masterId, firstName, lastName, time, service, note, website, shopSlug } = req.body;
  const clientIp = getClientIp(req);
  const sessionShop = await getAuthenticatedShop(req);
  const adminBypass = isAdminRequest(req) || Boolean(sessionShop);

  if (website) {
    return res.status(400).json({ error: 'Randevu isteği doğrulanamadı.' });
  }

  if (!adminBypass && !checkAppointmentRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Çok fazla randevu denemesi yaptınız. Lütfen biraz sonra tekrar deneyin.' });
  }

  const mId = parseInt(masterId, 10);
  if (Number.isNaN(mId)) {
    return res.status(400).json({ error: 'Lütfen usta seçin.' });
  }

  if (!firstName || !lastName || !time || !service) {
    return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
  }

  if (note && note.length > 150) {
    return res.status(400).json({ error: 'Not 150 karakteri geçemez.' });
  }

  const requestedTime = new Date(time);
  if (Number.isNaN(requestedTime.getTime())) {
    return res.status(400).json({ error: 'Geçersiz randevu zamanı.' });
  }

  try {
    let appointmentShop = sessionShop;

    if (!appointmentShop && shopSlug) {
      appointmentShop = await db.getShopBySlug(shopSlug);
    }

    if (!appointmentShop) {
      return res.status(400).json({ error: 'Randevu linki dogrulanamadi.' });
      return res.status(400).json({ error: 'Randevu linki doÄŸrulanamadÄ±.' });
    }

    const selectedMaster = await getShopMasterOrNull(appointmentShop.id, mId);
    if (!selectedMaster) {
      return res.status(400).json({ error: 'Gecersiz usta secimi.' });
      return res.status(400).json({ error: 'GeÃ§ersiz usta seÃ§imi.' });
    }

    if (!adminBypass) {
      const fromTime = toComparableLocalTime(new Date());
      const activeByIp = await db.countFutureAppointmentsByClientIp(clientIp, fromTime);
      if (activeByIp >= APPOINTMENT_MAX_ACTIVE_PER_IP) {
        return res.status(429).json({ error: 'Bu bağlantıdan çok fazla aktif randevu oluşturuldu. Lütfen işletmeyle iletişime geçin.' });
      }

      const activeByCustomer = await db.countFutureAppointmentsByCustomer(firstName.trim(), lastName.trim(), fromTime);
      if (activeByCustomer >= APPOINTMENT_MAX_ACTIVE_PER_CUSTOMER) {
        return res.status(429).json({ error: 'Bu isimle çok fazla aktif randevu bulunuyor. Lütfen işletmeyle iletişime geçin.' });
      }
    }

    const bufferMinutes = await db.getServiceBuffer(mId, service);
    const conflict = await db.hasAppointmentConflict(mId, requestedTime.toISOString(), bufferMinutes);
    if (conflict) {
      return res.status(409).json({ error: `Seçtiğiniz saat çakışma nedeniyle dolu.` });
    }

    const appointment = await db.createAppointment({ masterId: mId, firstName, lastName, time, service, note, clientIp });
    const master = await db.getMasterById(mId);
    res.json(appointment);
    await sendTelegramNotification(appointment, master ? master.name : 'Bilinmiyor');
  } catch (error) {
    res.status(500).json({ error: 'Randevu kaydedilemedi.' });
  }
});

app.patch('/api/appointments/:id', barberAuth, async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  const { masterId, firstName, lastName, time, service, note } = req.body;
  if (Number.isNaN(appointmentId)) {
    return res.status(400).json({ error: 'Geçersiz randevu kimliği.' });
  }

  const mId = masterId ? parseInt(masterId, 10) : null;
  if (Number.isNaN(mId)) {
    return res.status(400).json({ error: 'Lütfen usta seçin.' });
  }

  if (!firstName || !lastName || !time || !service) {
    return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
  }

  if (note && note.length > 150) {
    return res.status(400).json({ error: 'Not 150 karakteri geçemez.' });
  }

  const requestedTime = new Date(time);
  if (Number.isNaN(requestedTime.getTime())) {
    return res.status(400).json({ error: 'Geçersiz randevu zamanı.' });
  }

  try {
    const existingAppointment = await db.getAppointmentById(appointmentId);
    if (!(await appointmentBelongsToShop(existingAppointment, req.shop.id))) {
      return res.status(404).json({ error: 'Randevu bulunamadı.' });
    }

    const selectedMaster = await getShopMasterOrNull(req.shop.id, mId);
    if (!selectedMaster) {
      return res.status(400).json({ error: 'Geçersiz usta seçimi.' });
    }

    const bufferMinutes = await db.getServiceBuffer(mId, service);
    const conflict = await db.hasAppointmentConflict(mId, requestedTime.toISOString(), bufferMinutes, appointmentId);
    if (conflict) {
      return res.status(409).json({ error: 'Seçtiğiniz saat çakışma nedeniyle dolu.' });
    }

    const appointment = await db.updateAppointment(appointmentId, { masterId: mId, firstName, lastName, time, service, note });
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı.' });
    }
    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Randevu güncellenemedi.' });
  }
});

app.delete('/api/appointments/:id', barberAuth, async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  if (Number.isNaN(appointmentId)) {
    return res.status(400).json({ error: 'Geçersiz randevu kimliği.' });
  }

  try {
    const existingAppointment = await db.getAppointmentById(appointmentId);
    if (!(await appointmentBelongsToShop(existingAppointment, req.shop.id))) {
      return res.status(404).json({ error: 'Randevu bulunamadı.' });
    }

    const result = await db.deleteAppointment(appointmentId);
    if (!result.deleted) {
      return res.status(404).json({ error: 'Randevu bulunamadı.' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Randevu silinemedi.' });
  }
});

// list masters
app.get('/api/masters', async (req, res) => {
  try {
    const masters = await db.getMasters();
    res.json(masters);
  } catch (e) {
    res.status(500).json({ error: 'Ustalar yüklenemedi.' });
  }
});

app.get('/api/service-options', async (req, res) => {
  const masterId = req.query.masterId ? parseInt(req.query.masterId, 10) : null;
  if (!masterId) return res.status(400).json({ error: 'Usta parametresi eksik.' });

  try {
    if (req.query.shopSlug) {
      const shop = await db.getShopBySlug(req.query.shopSlug);
      const master = shop ? await getShopMasterOrNull(shop.id, masterId) : null;
      if (!master) return res.status(404).json({ error: 'Usta bulunamadÄ±.' });
    }

    const serviceSettings = await db.getServiceSettings(masterId);
    res.json({ serviceSettings });
  } catch (error) {
    res.status(500).json({ error: 'İşlem seçenekleri yüklenemedi.' });
  }
});

// availability per master
app.get('/api/availability', async (req, res) => {
  const { date, masterId, shopSlug } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Tarih parametresi eksik.' });
  }
  const mId = masterId ? parseInt(masterId, 10) : null;
  if (!mId) return res.status(400).json({ error: 'Usta parametresi eksik.' });

  console.log('/api/availability called', { date, masterId: mId });

  try {
    if (shopSlug) {
      const shop = await db.getShopBySlug(shopSlug);
      const master = shop ? await getShopMasterOrNull(shop.id, mId) : null;
      if (!master) return res.status(404).json({ error: 'Usta bulunamadÄ±.' });
    }

    const appointments = await db.getAppointmentsByDate(date, mId);

    const appointmentsWithBuffer = await Promise.all(appointments.map(async (a) => {
      const buffer = await db.getServiceBuffer(mId, a.service);
      return { ...a, bufferMinutes: buffer };
    }));

    const closures = await db.getClosuresByDate(mId, date);

    res.json({ appointments: appointmentsWithBuffer, closures });
  } catch (error) {
    console.error('Error in /api/availability:', error);
    res.status(500).json({ error: 'Uygunluk bilgisi alınamadı.' });
  }
});

app.get('/api/closures', barberAuth, async (req, res) => {
  const { date, masterId } = req.query;
  const master = await getShopMasterOrNull(req.shop.id, masterId);
  const mId = master ? master.id : null;
  if (!mId) return res.status(400).json({ error: 'Usta seçimi gerekli.' });
  if (!date) return res.status(400).json({ error: 'Tarih parametresi eksik.' });

  try {
    const closures = await db.getClosuresByDate(mId, date);
    res.json({ closures });
  } catch (error) {
    res.status(500).json({ error: 'Kapatmalar yüklenemedi.' });
  }
});

app.delete('/api/closures/:id', barberAuth, async (req, res) => {
  const closureId = parseInt(req.params.id, 10);
  if (Number.isNaN(closureId)) {
    return res.status(400).json({ error: 'Geçersiz kapanma kimliği.' });
  }

  try {
    const master = await getShopMasterOrNull(req.shop.id, req.query.masterId);
    if (!master) return res.status(400).json({ error: 'Usta seçimi gerekli.' });
    const result = await db.deleteClosure(closureId, master ? master.id : null);
    if (!result.deleted) {
      return res.status(404).json({ error: 'Kapatma bulunamadı.' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Kapatma silinemedi.' });
  }
});

// closures endpoints
app.post('/api/closures', barberAuth, async (req, res) => {
  const { masterId, start, end } = req.body;
  const master = await getShopMasterOrNull(req.shop.id, masterId);
  if (!start || !end) return res.status(400).json({ error: 'Eksik parametre' });
  if (!master) return res.status(400).json({ error: 'Usta seçimi gerekli.' });
  try {
    const c = await db.addClosure(master.id, start, end);
    res.json(c);
  } catch (e) {
    res.status(500).json({ error: 'Kapatma eklenemedi.' });
  }
});

app.get('/api/appointments', barberAuth, async (req, res) => {
  try {
    const master = await getShopMasterOrNull(req.shop.id, req.query.masterId);
    if (!master) return res.status(400).json({ error: 'Usta seçimi gerekli.' });
    const masterId = master.id;
    const appointments = await db.getAppointments(masterId);
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Randevular yüklenemedi.' });
  }
});



app.get('/api/settings', barberAuth, async (req, res) => {
  try {
    const master = await getShopMasterOrNull(req.shop.id, req.query.masterId);
    const masterId = master ? master.id : null;
    if (!masterId) {
      return res.status(400).json({ error: 'Usta seçimi gerekli.' });
    }

    const serviceSettings = await db.getServiceSettings(masterId);
    const serviceBuffers = {};
    const servicePrices = {};
    for (const item of serviceSettings) {
      serviceBuffers[item.service] = item.bufferMinutes;
      servicePrices[item.service] = item.price;
    }
    res.json({ serviceBuffers, servicePrices, masterId });
  } catch (error) {
    res.status(500).json({ error: 'Ayarlar yüklenemedi.' });
  }
});

app.post('/api/settings', barberAuth, async (req, res) => {
  const { serviceBuffers, servicePrices, masterId } = req.body;
  const master = await getShopMasterOrNull(req.shop.id, masterId);
  const selectedMasterId = master ? master.id : null;

  if (!selectedMasterId) {
    return res.status(400).json({ error: 'Lütfen önce bir usta seçin.' });
  }

  if (!serviceBuffers || typeof serviceBuffers !== 'object') {
    return res.status(400).json({ error: 'Lütfen hizmet başına süreleri gönderin.' });
  }

  if (!servicePrices || typeof servicePrices !== 'object') {
    return res.status(400).json({ error: 'Lütfen hizmet başına fiyatları gönderin.' });
  }

  try {
    for (const [service, value] of Object.entries(serviceBuffers)) {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 0) {
        return res.status(400).json({ error: `Geçersiz süre değeri for service ${service}.` });
      }
      const priceValue = parseFloat(servicePrices[service]);
      if (Number.isNaN(priceValue) || priceValue < 0) {
        return res.status(400).json({ error: `Geçersiz fiyat değeri for service ${service}.` });
      }
      await db.setServiceSetting(selectedMasterId, service, v, priceValue);
    }

    res.json({ serviceBuffers, servicePrices, masterId: selectedMasterId });
  } catch (error) {
    res.status(500).json({ error: 'Ayar kaydedilemedi.' });
  }
});

app.get('/randevu/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'randevu.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

async function startServer() {
  try {
    if (db.ready) {
      await db.ready;
    }

    app.listen(PORT, () => {
      console.log(`Server started on http://localhost:${PORT}`);
      console.log('Admin paneli: http://localhost:' + PORT + '/admin.html');
    });
  } catch (error) {
    console.error('Sunucu başlatılamadı. MySQL bağlantısını kontrol edin:', error.message || error);
    process.exit(1);
  }
}

startServer();
