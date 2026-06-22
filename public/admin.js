const calendarGrid = document.getElementById('calendarGrid');
const calendarMonthLabel = document.getElementById('calendarMonth');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const selectedDaySummary = document.getElementById('selectedDaySummary');
const timelineTitle = document.getElementById('timelineTitle');
const timeline = document.getElementById('timeline');
const settingsForm = document.getElementById('settingsForm');
const serviceSettingsContainer = document.getElementById('serviceSettings');
const masterCountInput = document.getElementById('masterCount');
const settingsMessage = document.getElementById('settingsMessage');

let appointments = [];
let displayedMonth = new Date();
displayedMonth.setDate(1);
let selectedDate = new Date();
let currentBufferMinutes = 30;
let currentMasterCount = 1;
const SERVICES = ['Saç Kesimi','Sakal Tıraşı','Yıkama & Stil','Saç Boyama','Çocuk Saç Kesimi'];

const WEEKDAYS = ['Pts', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

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
    button.addEventListener('click', () => {
      const [year, month, day] = button.dataset.date.split('-').map(Number);
      selectedDate = new Date(year, month - 1, day);
      renderCalendar();
      renderTimeline();
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
    return;
  }

  const items = dayAppointments.map(item => `
    <div class="timeline-item">
      <div class="time-block">${formatTime(item.timeObj)}</div>
      <div class="event-card">
        <div class="event-title">${item.firstName} ${item.lastName}</div>
        <div class="event-detail">${item.service}</div>
      </div>
    </div>
  `).join('');

  timeline.innerHTML = items;
}

function initControls() {
  prevMonthBtn.addEventListener('click', () => {
    displayedMonth.setMonth(displayedMonth.getMonth() - 1);
    renderCalendar();
  });

  nextMonthBtn.addEventListener('click', () => {
    displayedMonth.setMonth(displayedMonth.getMonth() + 1);
    renderCalendar();
  });

  settingsForm.addEventListener('submit', saveSettings);
}

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || 'Sunucudan gelen yanıt JSON değil.');
  }
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const settings = await parseJsonSafely(response);
    if (!response.ok) throw new Error(settings.error || 'Ayarlar yüklenemedi.');
    currentMasterCount = settings.masterCount ?? currentMasterCount;
    currentMasterCount = Number(currentMasterCount);
    masterCountInput.value = currentMasterCount;

    // render service-specific inputs
    serviceSettingsContainer.innerHTML = '';
    const buffers = settings.serviceBuffers || {};
    for (const s of SERVICES) {
      const v = buffers[s] ?? currentBufferMinutes;
      const row = document.createElement('label');
      row.innerHTML = `${s}<input type="number" name="service_${s}" data-service="${s}" min="0" step="1" value="${v}" required />`;
      serviceSettingsContainer.appendChild(row);
    }
  } catch (error) {
    settingsMessage.textContent = error.message;
    settingsMessage.className = 'message error';
  }
}

async function saveSettings(event) {
  event.preventDefault();
  settingsMessage.className = 'message';

  const masterValue = parseInt(masterCountInput.value, 10);
  if (Number.isNaN(masterValue) || masterValue < 1) {
    settingsMessage.textContent = 'Lütfen en az 1 usta sayısı girin.';
    settingsMessage.classList.add('error');
    return;
  }

  // collect service buffers
  const serviceBuffers = {};
  const inputs = serviceSettingsContainer.querySelectorAll('input[data-service]');
  for (const inp of inputs) {
    const sv = parseInt(inp.value, 10);
    const svc = inp.getAttribute('data-service');
    if (Number.isNaN(sv) || sv < 0) {
      settingsMessage.textContent = `Geçersiz süre değeri: ${svc}`;
      settingsMessage.classList.add('error');
      return;
    }
    serviceBuffers[svc] = sv;
  }

  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceBuffers, masterCount: masterValue })
    });

    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Ayar kaydedilemedi.');

    currentMasterCount = result.masterCount;
    settingsMessage.textContent = 'Ayar kaydedildi.';
    settingsMessage.classList.add('success');
  } catch (error) {
    settingsMessage.textContent = error.message;
    settingsMessage.classList.add('error');
  }
}

async function loadAppointments() {
  try {
    const response = await fetch('/api/appointments');
    if (!response.ok) throw new Error('Randevular yüklenemedi.');
    const result = await response.json();

    appointments = result.map(app => ({
      ...app,
      timeObj: new Date(app.time)
    }));

    initControls();
    await loadSettings();
    renderCalendar();
    renderTimeline();
  } catch (error) {
    timeline.innerHTML = `<p class="message error">${error.message}</p>`;
    selectedDaySummary.textContent = '';
  }
}

loadAppointments();
