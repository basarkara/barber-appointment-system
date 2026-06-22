const path = require('path');
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
const telegramBot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false }) : null;
const isTelegramEnabled = telegramBot && TELEGRAM_CHAT_ID;

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

app.post('/api/appointments', async (req, res) => {
  console.log('POST /api/appointments received', { body: req.body });

  const { masterId, firstName, lastName, time, service, note } = req.body;
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
    const bufferMinutes = await db.getServiceBuffer(mId, service);
    const conflict = await db.hasAppointmentConflict(mId, requestedTime.toISOString(), bufferMinutes);
    if (conflict) {
      return res.status(409).json({ error: `Seçtiğiniz saat çakışma nedeniyle dolu.` });
    }

    const appointment = await db.createAppointment({ masterId: mId, firstName, lastName, time, service, note });
    const master = await db.getMasterById(mId);
    res.json(appointment);
    await sendTelegramNotification(appointment, master ? master.name : 'Bilinmiyor');
  } catch (error) {
    res.status(500).json({ error: 'Randevu kaydedilemedi.' });
  }
});

app.patch('/api/appointments/:id', adminAuth, async (req, res) => {
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

app.delete('/api/appointments/:id', adminAuth, async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  if (Number.isNaN(appointmentId)) {
    return res.status(400).json({ error: 'Geçersiz randevu kimliği.' });
  }

  try {
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
    const serviceSettings = await db.getServiceSettings(masterId);
    res.json({ serviceSettings });
  } catch (error) {
    res.status(500).json({ error: 'İşlem seçenekleri yüklenemedi.' });
  }
});

// availability per master
app.get('/api/availability', async (req, res) => {
  const { date, masterId } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Tarih parametresi eksik.' });
  }
  const mId = masterId ? parseInt(masterId, 10) : null;
  if (!mId) return res.status(400).json({ error: 'Usta parametresi eksik.' });

  console.log('/api/availability called', { date, masterId: mId });

  try {
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

app.get('/api/closures', adminAuth, async (req, res) => {
  const { masterId, date } = req.query;
  const mId = masterId ? parseInt(masterId, 10) : null;
  if (!mId) return res.status(400).json({ error: 'Usta seçimi gerekli.' });
  if (!date) return res.status(400).json({ error: 'Tarih parametresi eksik.' });

  try {
    const closures = await db.getClosuresByDate(mId, date);
    res.json({ closures });
  } catch (error) {
    res.status(500).json({ error: 'Kapatmalar yüklenemedi.' });
  }
});

app.delete('/api/closures/:id', adminAuth, async (req, res) => {
  const closureId = parseInt(req.params.id, 10);
  if (Number.isNaN(closureId)) {
    return res.status(400).json({ error: 'Geçersiz kapanma kimliği.' });
  }

  try {
    const result = await db.deleteClosure(closureId);
    if (!result.deleted) {
      return res.status(404).json({ error: 'Kapatma bulunamadı.' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Kapatma silinemedi.' });
  }
});

// closures endpoints
app.post('/api/closures', adminAuth, async (req, res) => {
  const { masterId, start, end } = req.body;
  if (!masterId || !start || !end) return res.status(400).json({ error: 'Eksik parametre' });
  try {
    const c = await db.addClosure(masterId, start, end);
    res.json(c);
  } catch (e) {
    res.status(500).json({ error: 'Kapatma eklenemedi.' });
  }
});

app.get('/api/appointments', adminAuth, async (req, res) => {
  try {
    const masterId = req.query.masterId ? parseInt(req.query.masterId, 10) : null;
    const appointments = await db.getAppointments(masterId);
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Randevular yüklenemedi.' });
  }
});



app.get('/api/settings', adminAuth, async (req, res) => {
  try {
    const masterId = req.query.masterId ? parseInt(req.query.masterId, 10) : null;
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

app.post('/api/settings', adminAuth, async (req, res) => {
  const { serviceBuffers, servicePrices, masterId } = req.body;
  const selectedMasterId = masterId ? parseInt(masterId, 10) : null;

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

app.use('/admin.html', adminAuth);
app.use('/admin.js', adminAuth);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log('Admin paneli: http://localhost:' + PORT + '/admin.html');
});
