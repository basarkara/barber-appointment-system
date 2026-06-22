const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
const adminAuth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'Berber Randevu Sistemi'
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/appointments', async (req, res) => {
  const { firstName, lastName, time, service } = req.body;
  if (!firstName || !lastName || !time || !service) {
    return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
  }

  const requestedTime = new Date(time);
  if (Number.isNaN(requestedTime.getTime())) {
    return res.status(400).json({ error: 'Geçersiz randevu zamanı.' });
  }

  try {
    const bufferMinutes = await db.getServiceBuffer(service);
    const masterCount = await db.getSetting('masterCount');
    const conflict = await db.hasAppointmentConflict(requestedTime.toISOString(), bufferMinutes, masterCount);
    if (conflict) {
      return res.status(409).json({ error: `Seçtiğiniz saat, mevcut randevulardan en az ${bufferMinutes} dakika uzakta olmalı veya usta sayısı kadar randevu dolmuş olabilir.` });
    }

    const appointment = await db.createAppointment({ firstName, lastName, time, service });
    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Randevu kaydedilemedi.' });
  }
});

app.get('/api/appointments', adminAuth, async (req, res) => {
  try {
    const appointments = await db.getAppointments();
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Randevular yüklenemedi.' });
  }
});

app.get('/api/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Tarih parametresi eksik.' });
  }

  try {
    const masterCount = await db.getSetting('masterCount');
    const appointments = await db.getAppointmentsByDate(date);

    // attach service-specific buffer to each appointment
    const appointmentsWithBuffer = await Promise.all(appointments.map(async (a) => {
      const buffer = await db.getServiceBuffer(a.service);
      return { ...a, bufferMinutes: buffer };
    }));

    res.json({ masterCount, appointments: appointmentsWithBuffer });
  } catch (error) {
    res.status(500).json({ error: 'Uygunluk bilgisi alınamadı.' });
  }
});

app.get('/api/settings', adminAuth, async (req, res) => {
  try {
    const masterCount = await db.getSetting('masterCount');
    // list of known services
    const SERVICES = ['Saç Kesimi','Sakal Tıraşı','Yıkama & Stil','Saç Boyama','Çocuk Saç Kesimi'];
    const serviceBuffers = {};
    for (const s of SERVICES) {
      serviceBuffers[s] = await db.getServiceBuffer(s);
    }
    res.json({ masterCount, serviceBuffers });
  } catch (error) {
    res.status(500).json({ error: 'Ayarlar yüklenemedi.' });
  }
});

app.post('/api/settings', adminAuth, async (req, res) => {
  const { serviceBuffers, masterCount } = req.body;
  const masterValue = parseInt(masterCount, 10);

  if (Number.isNaN(masterValue) || masterValue < 1) {
    return res.status(400).json({ error: 'Lütfen en az 1 usta sayısı girin.' });
  }

  if (!serviceBuffers || typeof serviceBuffers !== 'object') {
    return res.status(400).json({ error: 'Lütfen hizmet başına süreleri gönderin.' });
  }

  try {
    // save each service buffer
    for (const [service, value] of Object.entries(serviceBuffers)) {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 0) {
        return res.status(400).json({ error: `Geçersiz süre değeri for service ${service}.` });
      }
      await db.setServiceBuffer(service, v);
    }

    await db.setSetting('masterCount', masterValue);
    res.json({ masterCount: masterValue, serviceBuffers });
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
