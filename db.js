const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('appointments.db');

const DEFAULT_BUFFER_MINUTES = 30;
const DEFAULT_MASTER_COUNT = 1;

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('bufferMinutes', ?)
  `, [String(DEFAULT_BUFFER_MINUTES)]);

  db.run(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('masterCount', ?)
  `, [String(DEFAULT_MASTER_COUNT)]);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS service_settings (
      service TEXT PRIMARY KEY,
      bufferMinutes INTEGER NOT NULL
    )
  `);
});

function getSettingValue(key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

function setSettingValue(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(value)],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function getServiceBuffer(service) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT bufferMinutes FROM service_settings WHERE service = ?`, [service], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.bufferMinutes : DEFAULT_BUFFER_MINUTES);
    });
  });
}

function setServiceBuffer(service, bufferMinutes) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO service_settings (service, bufferMinutes) VALUES (?, ?) ON CONFLICT(service) DO UPDATE SET bufferMinutes = excluded.bufferMinutes`,
      [service, bufferMinutes],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

module.exports = {
  createAppointment({ firstName, lastName, time, service }) {
    return new Promise((resolve, reject) => {
      const createdAt = new Date().toISOString();
      const normalizedTime = time;
      const stmt = db.prepare(`
        INSERT INTO appointments (firstName, lastName, time, service, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(firstName, lastName, normalizedTime, service, createdAt, function (err) {
        stmt.finalize();
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          firstName,
          lastName,
          time: normalizedTime,
          service,
          createdAt
        });
      });
    });
  },

  getAppointments() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, firstName, lastName, time, service, createdAt FROM appointments ORDER BY datetime(createdAt) DESC`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  getAppointmentsByDate(date) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, firstName, lastName, time, service, createdAt FROM appointments WHERE date(time) = date(?) ORDER BY datetime(time) ASC`,
        [date],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  getSetting(key) {
    return getSettingValue(key).then(value => {
      if (key === 'bufferMinutes') {
        return value ? parseInt(value, 10) : DEFAULT_BUFFER_MINUTES;
      }
      if (key === 'masterCount') {
        return value ? parseInt(value, 10) : DEFAULT_MASTER_COUNT;
      }
      return value;
    });
  },

  setSetting(key, value) {
    return setSettingValue(key, value);
  },

  getServiceBuffer(service) {
    return getServiceBuffer(service);
  },

  setServiceBuffer(service, minutes) {
    return setServiceBuffer(service, minutes);
  },

  hasAppointmentConflict(requestedTime, bufferMinutes, masterCount) {
    return new Promise((resolve, reject) => {
      const requested = new Date(requestedTime);
      const requestedStart = new Date(requested.getTime() - bufferMinutes * 60 * 1000);
      const requestedEnd = new Date(requested.getTime() + bufferMinutes * 60 * 1000);

      db.all(`SELECT time, service FROM appointments`, [], async (err, rows) => {
        if (err) return reject(err);
        try {
          let overlapCount = 0;
          for (const row of rows) {
            const existing = new Date(row.time);
            const existingBuffer = await getServiceBuffer(row.service);
            const existingStart = new Date(existing.getTime() - existingBuffer * 60 * 1000);
            const existingEnd = new Date(existing.getTime() + existingBuffer * 60 * 1000);

            // check interval overlap
            if (requestedStart < existingEnd && requestedEnd > existingStart) {
              overlapCount++;
            }
          }
          resolve(overlapCount >= masterCount);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
};
