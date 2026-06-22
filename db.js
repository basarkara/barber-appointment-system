const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('appointments.db');

const DEFAULT_BUFFER_MINUTES = 30;

const DEFAULT_MASTERS = ['Ali Usta', 'Mehmet Usta', 'Ahmet Usta'];

function ensureColumn(table, columnName, columnDefinition) {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) {
      console.error(`PRAGMA hatası for ${table}:`, err);
      return;
    }
    const exists = rows.some((column) => column.name === columnName);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`, (alterErr) => {
        if (alterErr) {
          console.error(`${table} tablosuna ${columnName} eklenirken hata:`, alterErr);
        } else {
          console.log(`${table} tablosuna ${columnName} sütunu eklendi.`);
        }
      });
    }
  });
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      masterId INTEGER NOT NULL,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(masterId) REFERENCES masters(id)
    )
  `);

  ensureColumn('appointments', 'masterId', 'masterId INTEGER NOT NULL DEFAULT 1');

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      masterId INTEGER,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(masterId, key),
      FOREIGN KEY(masterId) REFERENCES masters(id)
    )
  `);

  ensureColumn('settings', 'masterId', 'masterId INTEGER NOT NULL DEFAULT 1');

  db.run(`
    CREATE TABLE IF NOT EXISTS service_settings (
      masterId INTEGER,
      service TEXT NOT NULL,
      bufferMinutes INTEGER NOT NULL,
      PRIMARY KEY(masterId, service),
      FOREIGN KEY(masterId) REFERENCES masters(id)
    )
  `);

  ensureColumn('service_settings', 'masterId', 'masterId INTEGER NOT NULL DEFAULT 1');

  db.run(`
    CREATE TABLE IF NOT EXISTS closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      masterId INTEGER NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      FOREIGN KEY(masterId) REFERENCES masters(id)
    )
  `);

  // ensure default masters exist
  const insertMaster = db.prepare(`INSERT OR IGNORE INTO masters (name) VALUES (?)`);
  for (const m of DEFAULT_MASTERS) insertMaster.run(m);
  insertMaster.finalize();
});

function getSettingValue(masterId, key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE masterId IS ? AND key = ?`, [masterId, key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

function setSettingValue(masterId, key, value) {
  return new Promise((resolve, reject) => {
    db.run(
        `INSERT OR REPLACE INTO settings (masterId, key, value) VALUES (?, ?, ?)`,
        [masterId, key, String(value)],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function _getServiceBuffer(masterId, service) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT bufferMinutes FROM service_settings WHERE masterId IS ? AND service = ?`, [masterId, service], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.bufferMinutes : DEFAULT_BUFFER_MINUTES);
    });
  });
}

function _setServiceBuffer(masterId, service, bufferMinutes) {
  return new Promise((resolve, reject) => {
    db.run(
        `INSERT OR REPLACE INTO service_settings (masterId, service, bufferMinutes) VALUES (?, ?, ?)`,
        [masterId, service, bufferMinutes],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

module.exports = {
  async getMasters() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT id, name FROM masters ORDER BY id`, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  createAppointment({ masterId, firstName, lastName, time, service }) {
    return new Promise((resolve, reject) => {
      const createdAt = new Date().toISOString();
      const normalizedTime = time;
      const stmt = db.prepare(`
        INSERT INTO appointments (masterId, firstName, lastName, time, service, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(masterId, firstName, lastName, normalizedTime, service, createdAt, function (err) {
        stmt.finalize();
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          masterId,
          firstName,
          lastName,
          time: normalizedTime,
          service,
          createdAt
        });
      });
    });
  },

  getAppointments(masterId) {
    return new Promise((resolve, reject) => {
      const params = masterId ? [masterId] : [];
      const q = masterId ?
        `SELECT id, masterId, firstName, lastName, time, service, createdAt FROM appointments WHERE masterId = ? ORDER BY datetime(time) ASC` :
        `SELECT id, masterId, firstName, lastName, time, service, createdAt FROM appointments ORDER BY datetime(time) ASC`;
      db.all(q, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getAppointmentsByDate(date, masterId) {
    return new Promise((resolve, reject) => {
      const params = masterId ? [date, masterId] : [date];
      const q = masterId ?
        `SELECT id, masterId, firstName, lastName, time, service, createdAt FROM appointments WHERE date(time) = date(?) AND masterId = ? ORDER BY datetime(time) ASC` :
        `SELECT id, masterId, firstName, lastName, time, service, createdAt FROM appointments WHERE date(time) = date(?) ORDER BY datetime(time) ASC`;
      db.all(q, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getSetting(masterId, key) {
    return getSettingValue(masterId, key).then(value => {
      if (key === 'bufferMinutes') {
        return value ? parseInt(value, 10) : DEFAULT_BUFFER_MINUTES;
      }
      return value;
    });
  },

  setSetting(masterId, key, value) {
    return setSettingValue(masterId, key, value);
  },

  getServiceBuffer(masterId, service) {
    return _getServiceBuffer(masterId, service);
  },

  setServiceBuffer(masterId, service, minutes) {
    return _setServiceBuffer(masterId, service, minutes);
  },

  addClosure(masterId, start, end) {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO closures (masterId, start, end) VALUES (?, ?, ?)`, [masterId, start, end], function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, masterId, start, end });
      });
    });
  },

  getClosuresByDate(masterId, date) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT id, masterId, start, end FROM closures WHERE masterId = ? AND date(start) = date(?) ORDER BY start ASC`, [masterId, date], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  deleteClosure(closureId) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM closures WHERE id = ?`, [closureId], function (err) {
        if (err) return reject(err);
        resolve({ deleted: this.changes });
      });
    });
  },

  hasAppointmentConflict(masterId, requestedTime, bufferMinutes) {
    return new Promise((resolve, reject) => {
      const requested = new Date(requestedTime);
      const requestedStart = new Date(requested.getTime() - bufferMinutes * 60 * 1000);
      const requestedEnd = new Date(requested.getTime() + bufferMinutes * 60 * 1000);

      db.all(`SELECT time, service FROM appointments WHERE masterId = ?`, [masterId], async (err, rows) => {
        if (err) return reject(err);
        try {
          let overlapCount = 0;
          for (const row of rows) {
            const existing = new Date(row.time);
            const existingBuffer = await _getServiceBuffer(masterId, row.service);
            const existingStart = new Date(existing.getTime() - existingBuffer * 60 * 1000);
            const existingEnd = new Date(existing.getTime() + existingBuffer * 60 * 1000);

            if (requestedStart < existingEnd && requestedEnd > existingStart) {
              overlapCount++;
            }
          }
          // if any overlap, it's a conflict (single-master availability)
          resolve(overlapCount > 0);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
};
