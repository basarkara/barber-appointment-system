const calendarGrid = document.getElementById('calendarGrid');
const calendarMonthLabel = document.getElementById('calendarMonth');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const selectedDaySummary = document.getElementById('selectedDaySummary');
const timelineTitle = document.getElementById('timelineTitle');
const timeline = document.getElementById('timeline');
const settingsForm = document.getElementById('settingsForm');
const serviceSettingsContainer = document.getElementById('serviceSettings');
const settingsMessage = document.getElementById('settingsMessage');
const adminMasterSelect = document.getElementById('adminMasterSelect');
const closureForm = document.getElementById('closureForm');
const closureStartInput = document.getElementById('closureStart');
const closureEndInput = document.getElementById('closureEnd');
const closureMessage = document.getElementById('closureMessage');
const closureList = document.getElementById('closureList');
const appointmentForm = document.getElementById('appointmentForm');
const appointmentTimeInput = document.getElementById('appointmentTime');
const appointmentFirstNameInput = document.getElementById('appointmentFirstName');
const appointmentLastNameInput = document.getElementById('appointmentLastName');
const appointmentServiceSelect = document.getElementById('appointmentService');
const appointmentNoteInput = document.getElementById('appointmentNote');
const appointmentSubmitBtn = document.getElementById('appointmentSubmitBtn');
const appointmentCancelEditBtn = document.getElementById('appointmentCancelEditBtn');
const appointmentMessage = document.getElementById('appointmentMessage');
const appointmentList = document.getElementById('appointmentList');
const panelMasterName = document.getElementById('panelMasterName');
const generateAppointmentLinkBtn = document.getElementById('generateAppointmentLinkBtn');
const appointmentLinkInput = document.getElementById('appointmentLinkInput');
const copyAppointmentLinkBtn = document.getElementById('copyAppointmentLinkBtn');
const generateQrCodeBtn = document.getElementById('generateQrCodeBtn');
const printQrCodeBtn = document.getElementById('printQrCodeBtn');
const qrCodePanel = document.getElementById('qrCodePanel');
const qrCodeImage = document.getElementById('qrCodeImage');
const qrCodeUrl = document.getElementById('qrCodeUrl');
const logoutBtn = document.getElementById('logoutBtn');
const linkMessage = document.getElementById('linkMessage');
const adminTabs = document.querySelectorAll('[data-admin-tab]');
const adminScreens = document.querySelectorAll('[data-admin-screen]');

let appointments = [];
let currentShop = null;
let currentAppointmentUrl = '';
let currentQrDataUrl = '';
let displayedMonth = new Date();
displayedMonth.setDate(1);
let selectedDate = new Date();
let currentBufferMinutes = 30;
let currentClosures = [];
let editingAppointmentId = null;
let controlsInitialized = false;
let activeAdminScreen = 'calendar';
const SERVICES = ['Saç Kesimi','Sakal Tıraşı','Yıkama & Stil','Saç Boyama','Çocuk Saç Kesimi'];

const WEEKDAYS = ['Pts', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function populateAppointmentServiceOptions() {
  if (!appointmentServiceSelect) return;
  appointmentServiceSelect.innerHTML = SERVICES
    .map(service => `<option value="${service}">${service}</option>`)
    .join('');
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(date) {
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function groupAppointmentsByDate(items) {
  return items.reduce((map, appointment) => {
    const dateKey = formatDateKey(appointment.timeObj);
    if (!map[dateKey]) map[dateKey] = [];
    map[dateKey].push(appointment);
    return map;
  }, {});
}

function getAppointmentsForDate(date) {
  const dateKey = formatDateKey(date);
  return appointments
    .filter(item => formatDateKey(item.timeObj) === dateKey)
    .sort((a, b) => a.timeObj - b.timeObj);
}

function renderCalendar() {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  calendarMonthLabel.textContent = displayedMonth.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1);
  const startDayIndex = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dateMap = groupAppointmentsByDate(appointments);

  const cells = [];
  for (let i = 0; i < startDayIndex; i++) {
    cells.push('<div class="calendar-cell empty"></div>');
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);
    const isSelected = formatDateKey(date) === formatDateKey(selectedDate);
    const hasAppointment = Boolean(dateMap[dateKey]);

    cells.push(`
      <button type="button" class="calendar-cell day ${isSelected ? 'selected' : ''} ${hasAppointment ? 'has-appointment' : ''}" data-date="${dateKey}">
        <span>${day}</span>
      </button>
    `);
  }

  calendarGrid.innerHTML = `
    <div class="calendar-row calendar-weekdays">
      ${WEEKDAYS.map(day => `<div class="calendar-cell header">${day}</div>`).join('')}
    </div>
    <div class="calendar-row days-grid">
      ${cells.join('')}
    </div>
  `;

  document.querySelectorAll('.calendar-cell.day').forEach(button => {
    button.addEventListener('click', async () => {
      const [year, month, day] = button.dataset.date.split('-').map(Number);
      selectedDate = new Date(year, month - 1, day);
      renderCalendar();
      renderTimeline();
      await loadClosures();
    });
  });
}

function renderTimeline() {
  const dateKey = formatDateKey(selectedDate);
  const dayName = selectedDate.toLocaleDateString('tr-TR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const dayAppointments = getAppointmentsForDate(selectedDate);
  selectedDaySummary.innerHTML = `<strong>Seçilen gün:</strong> ${dayName}`;
  timelineTitle.textContent = `${dayName} için Zaman Çizelgesi`;

  if (!dayAppointments.length) {
    timeline.innerHTML = '<p class="empty-state">Bu gün için kayıtlı randevu yok.</p>';
    appointmentList.innerHTML = '<p class="empty-state">Bu gün için düzenlenebilir randevu yok.</p>';
    return;
  }

  const items = dayAppointments.map(item => `
    <div class="timeline-item">
      <div class="time-block">${formatTime(item.timeObj)}</div>
      <div class="event-card">
        <div class="event-title">${item.firstName} ${item.lastName}</div>
        <div class="event-detail">${item.service}${item.note ? ` • Not: ${item.note}` : ''}</div>
      </div>
    </div>
  `).join('');

  timeline.innerHTML = items;
  renderAppointmentList();
}

function resetAppointmentForm() {
  editingAppointmentId = null;
  appointmentTimeInput.value = '';
  appointmentFirstNameInput.value = '';
  appointmentLastNameInput.value = '';
  appointmentServiceSelect.value = SERVICES[0];
  appointmentNoteInput.value = '';
  appointmentSubmitBtn.textContent = 'Randevu Ekle';
  appointmentCancelEditBtn.hidden = true;
  appointmentMessage.textContent = '';
  appointmentMessage.className = 'message';
}

function renderAppointmentList() {
  const dayAppointments = getAppointmentsForDate(selectedDate);
  if (!dayAppointments.length) {
    appointmentList.innerHTML = '<p class="empty-state">Bu gün için düzenlenebilir randevu yok.</p>';
    return;
  }

  appointmentList.innerHTML = dayAppointments.map(item => `
    <div class="appointment-item">
      <div>
        <div class="event-title">${formatTime(item.timeObj)} • ${item.firstName} ${item.lastName}</div>
        <div class="event-detail">${item.service}${item.note ? ` • Not: ${item.note}` : ''}</div>
      </div>
      <div class="appointment-actions">
        <button type="button" class="appointment-edit-button" data-id="${item.id}">Düzenle</button>
        <button type="button" class="appointment-delete-button" data-id="${item.id}">Sil</button>
      </div>
    </div>
  `).join('');

  appointmentList.querySelectorAll('.appointment-edit-button').forEach(button => {
    button.addEventListener('click', () => editAppointment(button.dataset.id));
  });

  appointmentList.querySelectorAll('.appointment-delete-button').forEach(button => {
    button.addEventListener('click', () => deleteAppointmentById(button.dataset.id));
  });
}

function editAppointment(appointmentId) {
  const appointment = appointments.find(item => String(item.id) === String(appointmentId));
  if (!appointment) return;

  editingAppointmentId = appointment.id;
  appointmentTimeInput.value = appointment.timeObj.toISOString().slice(0, 16);
  appointmentFirstNameInput.value = appointment.firstName;
  appointmentLastNameInput.value = appointment.lastName;
  appointmentServiceSelect.value = appointment.service;
  appointmentNoteInput.value = appointment.note || '';
  appointmentSubmitBtn.textContent = 'Randevuyu Güncelle';
  appointmentCancelEditBtn.hidden = false;
  appointmentMessage.textContent = 'Randevu düzenleme modunda.';
  appointmentMessage.className = 'message';
}

async function deleteAppointmentById(appointmentId) {
  try {
    const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}`, {
      method: 'DELETE'
    });
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Randevu silinemedi.');
    appointmentMessage.textContent = 'Randevu silindi.';
    appointmentMessage.classList.add('success');
    resetAppointmentForm();
    await loadAppointments();
  } catch (error) {
    appointmentMessage.textContent = error.message;
    appointmentMessage.classList.add('error');
  }
}

async function saveAppointment(event) {
  event.preventDefault();
  appointmentMessage.className = 'message';

  const masterId = adminMasterSelect ? adminMasterSelect.value : null;
  if (!masterId) {
    appointmentMessage.textContent = 'Lütfen önce bir usta seçin.';
    appointmentMessage.classList.add('error');
    return;
  }

  const time = appointmentTimeInput.value;
  const firstName = appointmentFirstNameInput.value.trim();
  const lastName = appointmentLastNameInput.value.trim();
  const service = appointmentServiceSelect.value;
  const note = appointmentNoteInput.value.trim();

  if (!time || !firstName || !lastName || !service) {
    appointmentMessage.textContent = 'Lütfen tüm alanları doldurun.';
    appointmentMessage.classList.add('error');
    return;
  }

  if (note.length > 150) {
    appointmentMessage.textContent = 'Not 150 karakteri geçemez.';
    appointmentMessage.classList.add('error');
    return;
  }

  const requestBody = { masterId, firstName, lastName, time, service, note };
  const method = editingAppointmentId ? 'PATCH' : 'POST';
  const url = editingAppointmentId ? `/api/appointments/${editingAppointmentId}` : '/api/appointments';

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Randevu kaydedilemedi.');

    appointmentMessage.textContent = editingAppointmentId ? 'Randevu güncellendi.' : 'Randevu eklendi.';
    appointmentMessage.classList.add('success');
    resetAppointmentForm();
    await loadAppointments();
  } catch (error) {
    appointmentMessage.textContent = error.message;
    appointmentMessage.classList.add('error');
  }
}

function initControls() {
  if (controlsInitialized) return;
  controlsInitialized = true;

  adminTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      showAdminScreen(tab.dataset.adminTab);
    });
  });

  prevMonthBtn.addEventListener('click', () => {
    displayedMonth.setMonth(displayedMonth.getMonth() - 1);
    renderCalendar();
  });

  nextMonthBtn.addEventListener('click', () => {
    displayedMonth.setMonth(displayedMonth.getMonth() + 1);
    renderCalendar();
  });

  settingsForm.addEventListener('submit', saveSettings);
  if (closureForm) {
    closureForm.addEventListener('submit', saveClosure);
  }

  if (appointmentForm) {
    appointmentForm.addEventListener('submit', saveAppointment);
  }

  if (appointmentCancelEditBtn) {
    appointmentCancelEditBtn.addEventListener('click', () => {
      resetAppointmentForm();
    });
  }

  if (generateAppointmentLinkBtn) {
    generateAppointmentLinkBtn.addEventListener('click', generateAppointmentLink);
  }

  if (copyAppointmentLinkBtn) {
    copyAppointmentLinkBtn.addEventListener('click', copyAppointmentLink);
  }

  if (generateQrCodeBtn) {
    generateQrCodeBtn.addEventListener('click', generateQrCode);
  }

  if (printQrCodeBtn) {
    printQrCodeBtn.addEventListener('click', printQrCode);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  if (adminMasterSelect) {
    adminMasterSelect.addEventListener('change', async () => {
      resetAppointmentForm();
      await loadAppointments();
    });
  }

  showAdminScreen(activeAdminScreen);
}

function showAdminScreen(screenName) {
  activeAdminScreen = screenName || 'calendar';

  adminTabs.forEach(tab => {
    const isActive = tab.dataset.adminTab === activeAdminScreen;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  adminScreens.forEach(screen => {
    screen.hidden = screen.dataset.adminScreen !== activeAdminScreen;
  });

  if (activeAdminScreen === 'calendar') {
    renderCalendar();
    renderTimeline();
  }
}

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || 'Sunucudan gelen yanıt JSON değil.');
  }
}

async function loadBarberSession() {
  const response = await fetch('/api/barber-session');
  const result = await parseJsonSafely(response);
  if (!response.ok) {
    window.location.href = '/login.html';
    throw new Error(result.error || 'Oturum bulunamadı.');
  }

  currentShop = result.shop;
  currentAppointmentUrl = result.appointmentUrl;
  const masters = result.masters || [];
  adminMasterSelect.innerHTML = masters.length
    ? masters.map(master => `<option value="${master.id}">${master.name}</option>`).join('')
    : '<option value="">Usta bulunamadi</option>';
  if (masters.length) {
    adminMasterSelect.value = String(masters[0].id);
  }
  panelMasterName.textContent = currentShop
    ? `${currentShop.name} icin dukkan paneli`
    : 'Dukkan paneli';
  appointmentLinkInput.value = currentAppointmentUrl || '';
}

async function generateAppointmentLink() {
  linkMessage.className = 'message';
  linkMessage.textContent = '';

  try {
    const response = await fetch('/api/barber-appointment-link');
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Link oluşturulamadı.');

    currentAppointmentUrl = result.appointmentUrl;
    appointmentLinkInput.value = currentAppointmentUrl;
    linkMessage.textContent = 'Randevu linkiniz hazır.';
    linkMessage.classList.add('success');
  } catch (error) {
    linkMessage.textContent = error.message;
    linkMessage.classList.add('error');
  }
}

async function copyAppointmentLink() {
  if (!appointmentLinkInput.value) {
    await generateAppointmentLink();
  }

  try {
    await navigator.clipboard.writeText(appointmentLinkInput.value);
    linkMessage.textContent = 'Randevu linki kopyalandı.';
    linkMessage.className = 'message success';
  } catch {
    appointmentLinkInput.select();
    linkMessage.textContent = 'Link alanını seçtim, kopyalamak için Ctrl+C kullanabilirsiniz.';
    linkMessage.className = 'message warning';
  }
}

async function generateQrCode() {
  linkMessage.className = 'message';
  linkMessage.textContent = '';

  try {
    const response = await fetch('/api/barber-appointment-qr');
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'QR kod oluşturulamadı.');

    currentAppointmentUrl = result.appointmentUrl;
    currentQrDataUrl = result.qrDataUrl;
    appointmentLinkInput.value = currentAppointmentUrl;
    qrCodeImage.src = currentQrDataUrl;
    qrCodeUrl.textContent = currentAppointmentUrl;
    qrCodePanel.hidden = false;
    printQrCodeBtn.disabled = false;
    linkMessage.textContent = 'QR kodunuz hazır.';
    linkMessage.className = 'message success';
  } catch (error) {
    linkMessage.textContent = error.message;
    linkMessage.className = 'message error';
  }
}

function printQrCode() {
  if (!currentQrDataUrl || !currentAppointmentUrl) {
    linkMessage.textContent = 'Önce QR kod oluşturun.';
    linkMessage.className = 'message warning';
    return;
  }

  const printWindow = window.open('', '_blank', 'width=720,height=800');
  if (!printWindow) {
    linkMessage.textContent = 'Yazdırma penceresi açılamadı. Tarayıcı izinlerini kontrol edin.';
    linkMessage.className = 'message error';
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charset="utf-8" />
        <title>BerberTakip QR Kod</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            color: #0f172a;
          }
          .print-card {
            width: min(92vw, 520px);
            text-align: center;
            padding: 32px;
            border: 1px solid #cbd5e1;
            border-radius: 18px;
          }
          h1 {
            margin: 0 0 10px;
            font-size: 28px;
          }
          p {
            margin: 8px 0 20px;
            color: #475569;
            overflow-wrap: anywhere;
          }
          img {
            width: 320px;
            height: 320px;
            max-width: 100%;
          }
        </style>
      </head>
      <body>
        <section class="print-card">
          <h1>BerberTakip Randevu</h1>
          <p>${currentAppointmentUrl}</p>
          <img src="${currentQrDataUrl}" alt="Randevu QR kodu" />
        </section>
        <script>
          window.onload = () => {
            window.focus();
            window.print();
          };
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

async function logout() {
  await fetch('/api/barber-logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function loadSettings() {
  try {
    const masterId = adminMasterSelect ? adminMasterSelect.value : null;
    if (!masterId) {
      settingsMessage.textContent = 'Lütfen önce bir usta seçin.';
      settingsMessage.className = 'message warning';
      serviceSettingsContainer.innerHTML = '';
      closureList.innerHTML = '';
      return;
    }

    const response = await fetch(`/api/settings?masterId=${encodeURIComponent(masterId)}`);
    const settings = await parseJsonSafely(response);
    if (!response.ok) throw new Error(settings.error || 'Ayarlar yüklenemedi.');

    serviceSettingsContainer.innerHTML = '';
    const buffers = settings.serviceBuffers || {};
    const prices = settings.servicePrices || {};
    for (const s of SERVICES) {
      const bufferValue = buffers[s] ?? currentBufferMinutes;
      const priceValue = prices[s] ?? 0;
      const row = document.createElement('div');
      row.className = 'service-setting-row';
      row.innerHTML = `
        <label>
          ${s}
          <div class="service-setting-fields">
            <input type="number" name="service_${s}_buffer" data-service="${s}" min="0" step="1" value="${bufferValue}" required placeholder="Aralık (dakika)" />
            <input type="number" name="service_${s}_price" data-service-price="${s}" min="0" step="0.01" value="${priceValue}" required placeholder="Fiyat (₺)" />
          </div>
        </label>
      `;
      serviceSettingsContainer.appendChild(row);
    }
    populateAppointmentServiceOptions();
    settingsMessage.textContent = '';
    settingsMessage.className = 'message';
  } catch (error) {
    settingsMessage.textContent = error.message;
    settingsMessage.className = 'message error';
  }
}

async function saveSettings(event) {
  event.preventDefault();
  settingsMessage.className = 'message';

  // collect service buffers
  const serviceBuffers = {};
  const servicePrices = {};
  const bufferInputs = serviceSettingsContainer.querySelectorAll('input[data-service]');
  const priceInputs = serviceSettingsContainer.querySelectorAll('input[data-service-price]');

  for (const inp of bufferInputs) {
    const sv = parseInt(inp.value, 10);
    const svc = inp.getAttribute('data-service');
    if (Number.isNaN(sv) || sv < 0) {
      settingsMessage.textContent = `Geçersiz süre değeri: ${svc}`;
      settingsMessage.classList.add('error');
      return;
    }
    serviceBuffers[svc] = sv;
  }

  for (const inp of priceInputs) {
    const pv = parseFloat(inp.value);
    const svc = inp.getAttribute('data-service-price');
    if (Number.isNaN(pv) || pv < 0) {
      settingsMessage.textContent = `Geçersiz fiyat değeri: ${svc}`;
      settingsMessage.classList.add('error');
      return;
    }
    servicePrices[svc] = pv;
  }

  try {
    const masterId = adminMasterSelect ? adminMasterSelect.value : null;
    if (!masterId) {
      settingsMessage.textContent = 'Lütfen önce bir usta seçin.';
      settingsMessage.classList.add('error');
      return;
    }

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceBuffers, servicePrices, masterId })
    });

    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Ayar kaydedilemedi.');

    settingsMessage.textContent = 'Ayar kaydedildi.';
    settingsMessage.classList.add('success');
  } catch (error) {
    settingsMessage.textContent = error.message;
    settingsMessage.classList.add('error');
  }
}

function renderClosureList() {
  if (!currentClosures.length) {
    closureList.innerHTML = '<p class="empty-state">Seçilen gün için kapatma bulunmuyor.</p>';
    return;
  }

  closureList.innerHTML = currentClosures.map(closure => {
    const start = new Date(closure.start).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const end = new Date(closure.end).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `
      <div class="closure-item">
        <div class="closure-label"><strong>${start} - ${end}</strong></div>
        <button type="button" class="closure-remove-button" data-closure-id="${closure.id}">İptal et</button>
      </div>
    `;
  }).join('');

  closureList.querySelectorAll('.closure-remove-button').forEach(button => {
    button.addEventListener('click', async () => {
      const closureId = button.dataset.closureId;
      await deleteClosure(closureId);
    });
  });
}

async function loadClosures() {
  const masterId = adminMasterSelect ? adminMasterSelect.value : null;
  if (!masterId) {
    closureList.innerHTML = '';
    return;
  }

  const currentDate = formatDateKey(selectedDate);
  try {
    const response = await fetch(`/api/closures?masterId=${encodeURIComponent(masterId)}&date=${encodeURIComponent(currentDate)}`);
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Kapatmalar yüklenemedi.');
    currentClosures = result.closures || [];
    renderClosureList();
  } catch (error) {
    closureList.innerHTML = `<p class="message error">${error.message}</p>`;
  }
}

async function deleteClosure(closureId) {
  const masterId = adminMasterSelect ? adminMasterSelect.value : null;
  if (!masterId) {
    closureMessage.textContent = 'Lütfen önce bir usta seçin.';
    closureMessage.classList.add('error');
    return;
  }

  try {
    const response = await fetch(`/api/closures/${encodeURIComponent(closureId)}?masterId=${encodeURIComponent(masterId)}`, {
      method: 'DELETE'
    });
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Kapatma silinemedi.');
    closureMessage.textContent = 'Kapatma iptal edildi.';
    closureMessage.classList.add('success');
    await loadClosures();
    renderCalendar();
    renderTimeline();
  } catch (error) {
    closureMessage.textContent = error.message;
    closureMessage.classList.add('error');
  }
}

async function saveClosure(event) {
  event.preventDefault();
  closureMessage.className = 'message';

  const masterId = adminMasterSelect ? adminMasterSelect.value : null;
  if (!masterId) {
    closureMessage.textContent = 'Lütfen önce bir usta seçin.';
    closureMessage.classList.add('error');
    return;
  }

  const start = closureStartInput.value;
  const end = closureEndInput.value;
  if (!start || !end) {
    closureMessage.textContent = 'Başlangıç ve bitiş zamanlarını girin.';
    closureMessage.classList.add('error');
    return;
  }

  if (new Date(start) >= new Date(end)) {
    closureMessage.textContent = 'Bitiş zamanı başlangıçtan sonra olmalıdır.';
    closureMessage.classList.add('error');
    return;
  }

  try {
    const response = await fetch('/api/closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId, start, end })
    });

    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Kapatma eklenemedi.');

    closureMessage.textContent = 'Kapatma eklendi.';
    closureMessage.classList.add('success');
    closureStartInput.value = '';
    closureEndInput.value = '';
    await loadClosures();
    renderCalendar();
    renderTimeline();
  } catch (error) {
    closureMessage.textContent = error.message;
    closureMessage.classList.add('error');
  }
}

async function loadAppointments() {
  try {
    const masterId = adminMasterSelect ? adminMasterSelect.value : null;
    const response = await fetch(`/api/appointments${masterId ? `?masterId=${encodeURIComponent(masterId)}` : ''}`);
    if (!response.ok) throw new Error('Randevular yüklenemedi.');
    const result = await response.json();

    appointments = result.map(app => ({
      ...app,
      timeObj: new Date(app.time)
    }));

    await loadSettings();
    renderCalendar();
    renderTimeline();
    await loadClosures();
  } catch (error) {
    timeline.innerHTML = `<p class="message error">${error.message}</p>`;
    selectedDaySummary.textContent = '';
  }
}

async function loadMasters() {
  if (!adminMasterSelect) return;
  try {
    const res = await fetch('/api/masters');
    const masters = await res.json();
    adminMasterSelect.innerHTML = `<option value="">Bir usta seçin</option>` + masters.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    adminMasterSelect.addEventListener('change', async () => {
      resetAppointmentForm();
      await loadAppointments();
      renderCalendar();
      renderTimeline();
      await loadClosures();
    });
  } catch (e) {
    console.error('Masters yüklenemedi', e);
  }
}

// initialize masters then appointments
loadBarberSession().then(async () => {
  initControls();
  populateAppointmentServiceOptions();
  await loadAppointments();
});
