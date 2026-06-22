const form = document.getElementById('appointmentForm');
const messageBox = document.getElementById('message');
const dateInput = document.getElementById('appointmentDate');
const timeSelect = document.getElementById('appointmentTime');
const slotInfo = document.getElementById('slotInfo');
const masterSelect = document.getElementById('masterSelect');
const serviceSelect = document.getElementById('serviceSelect');
const servicePriceInfo = document.getElementById('servicePriceInfo');
const appointmentNoteInput = document.getElementById('appointmentNote');

let serviceOptions = [];

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;
const TIME_STEP_MINUTES = 15;

function formatOptionLabel(date) {
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getIsoDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateTimeString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isSlotBlocked(slotStart, blockedIntervals) {
  const slotEnd = addMinutes(slotStart, TIME_STEP_MINUTES);
  return blockedIntervals.some(interval => slotStart < interval.end && slotEnd > interval.start);
}

function formatBlockedIntervals(blockedIntervals) {
  if (!blockedIntervals.length) return 'Seçilen gün için tüm saatler boş.';
  return blockedIntervals.map(interval => {
    const start = interval.start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const end = interval.end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${start} - ${end}`;
  }).join(', ');
}

function buildBlockedIntervals(appointments) {
  return appointments.map(app => {
    const apptTime = new Date(app.time);
    const buffer = app.bufferMinutes ?? 30;
    return {
      start: addMinutes(apptTime, -buffer),
      end: addMinutes(apptTime, buffer)
    };
  });
}

function makeSlotList(date, blockedIntervals) {
  const slots = [];
  const dayStart = new Date(`${getIsoDateString(date)}T${String(BUSINESS_START_HOUR).padStart(2, '0')}:00:00`);
  const dayEnd = new Date(`${getIsoDateString(date)}T${String(BUSINESS_END_HOUR).padStart(2, '0')}:00:00`);
  const now = new Date();

  for (let current = new Date(dayStart); current < dayEnd; current = addMinutes(current, TIME_STEP_MINUTES)) {
    const overlapCount = blockedIntervals.filter(interval => current >= interval.start && current < interval.end).length;
    const disabled = current < now || overlapCount > 0;
    slots.push({ time: formatOptionLabel(current), value: localDateTimeString(current), disabled });
  }

  return slots;
}

async function fetchAvailability(date) {
  slotInfo.textContent = 'Müsait saatler sorgulanıyor...';
  timeSelect.innerHTML = '<option value="">Yükleniyor...</option>';

  try {
    const masterId = masterSelect ? masterSelect.value : null;
    if (!masterId) {
      slotInfo.textContent = 'Lütfen bir usta seçin.';
      timeSelect.innerHTML = '<option value="">Lütfen usta seçin</option>';
      return;
    }

    const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}&masterId=${encodeURIComponent(masterId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Uygunluk bilgisi alınamadı.');

    // build blocked intervals from appointments and closures
    const appointmentBlocked = buildBlockedIntervals(result.appointments);
    const closureIntervals = (result.closures || []).map(c => ({ start: new Date(c.start), end: new Date(c.end) }));
    const blockedIntervals = appointmentBlocked.concat(closureIntervals);

    const slots = makeSlotList(new Date(`${date}T00:00:00`), blockedIntervals);

    const options = slots.map(slot => `
      <option value="${slot.value}" ${slot.disabled ? 'disabled' : ''}>
        ${slot.time}${slot.disabled ? ' (dolu)' : ''}
      </option>
    `).join('');

    timeSelect.innerHTML = `<option value="">Lütfen saat seçin</option>${options}`;
    slotInfo.textContent = blockedIntervals.length
      ? `Mevcut randevular ve kapalı zaman dilimleri: ${formatBlockedIntervals(blockedIntervals)}`
      : 'Seçilen gün için tüm saatler müsait.';
  } catch (error) {
    slotInfo.textContent = error.message;
    timeSelect.innerHTML = '<option value="">Saat bilgisi yüklenemedi</option>';
  }
}

async function loadMasters() {
  if (!masterSelect) return;
  try {
    const res = await fetch('/api/masters');
    const masters = await res.json();
    masterSelect.innerHTML = `<option value="">Lütfen usta seçin</option>` + masters.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    // when master changes, reload availability and services
    masterSelect.addEventListener('change', () => {
      const masterId = masterSelect.value;
      if (masterId) {
        loadServiceOptions(masterId);
      }
      if (dateInput.value) fetchAvailability(dateInput.value);
    });
  } catch (e) {
    console.error('Masters yüklenemedi', e);
  }
}

function setDefaultDate() {
  const today = new Date();
  dateInput.value = getIsoDateString(today);
  if (masterSelect.value) {
    loadServiceOptions(masterSelect.value);
  }
  fetchAvailability(dateInput.value);
}

dateInput.addEventListener('change', () => {
  if (dateInput.value) {
    fetchAvailability(dateInput.value);
  }
});

serviceSelect.addEventListener('change', () => {
  const selected = serviceOptions.find(option => option.service === serviceSelect.value);
  if (selected) {
    servicePriceInfo.textContent = `Seçilen işlem fiyatı: ₺${selected.price.toFixed(2)}`;
  } else {
    servicePriceInfo.textContent = 'Seçilen işlem için fiyat burada gösterilecektir.';
  }
});

async function loadServiceOptions(masterId) {
  if (!serviceSelect) return;
  try {
    const response = await fetch(`/api/service-options?masterId=${encodeURIComponent(masterId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'İşlem seçenekleri yüklenemedi.');
    serviceOptions = result.serviceSettings || [];
    serviceSelect.innerHTML = `<option value="">Seçiniz</option>` + serviceOptions.map(opt => `
      <option value="${opt.service}">${opt.service} (₺${Number(opt.price).toFixed(2)})</option>
    `).join('');
    servicePriceInfo.textContent = 'Seçilen işlem için fiyat burada gösterilecektir.';
  } catch (error) {
    serviceSelect.innerHTML = '<option value="">İşlem seçenekleri yüklenemedi</option>';
    servicePriceInfo.textContent = error.message;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageBox.className = 'message';

  const formData = new FormData(form);
  const dateValue = formData.get('date');
  const timeValue = formData.get('time');
  const masterId = formData.get('masterId');
  if (!dateValue || !timeValue) {
    messageBox.textContent = 'Lütfen tarih ve saat seçin.';
    messageBox.classList.add('error');
    return;
  }

  const payload = {
    masterId,
    firstName: formData.get('firstName').trim(),
    lastName: formData.get('lastName').trim(),
    time: timeValue,
    service: formData.get('service'),
    note: (formData.get('note') || '').trim()
  };

  try {
    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Bir hata oluştu.');

    messageBox.textContent = 'Randevunuz kaydedildi. Teşekkürler!';
    messageBox.classList.add('success');
    form.reset();
    setDefaultDate();
  } catch (error) {
    messageBox.textContent = error.message;
    messageBox.classList.add('error');
  }
});

// initialize masters then date
loadMasters().then(() => setDefaultDate());
