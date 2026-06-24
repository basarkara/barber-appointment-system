const mysql = require('mysql2/promise');

const DEFAULT_BUFFER_MINUTES = 30;
const DEFAULT_MASTERS = ['Ali Usta', 'Mehmet Usta', 'Ahmet Usta'];
const SERVICES = ['Saç Kesimi', 'Sakal Tıraşı', 'Yıkama & Stil', 'Saç Boyama', 'Çocuk Saç Kesimi'];

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'barber_appointment_system',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  charset: 'utf8mb4',
  timezone: 'Z'
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  if (!Number(rows[0].count)) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
  }
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masters (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INT NOT NULL AUTO_INCREMENT,
      masterId INT NOT NULL,
      firstName VARCHAR(100) NOT NULL,
      lastName VARCHAR(100) NOT NULL,
      time VARCHAR(32) NOT NULL,
      service VARCHAR(100) NOT NULL,
      note VARCHAR(150) NULL,
      clientIp VARCHAR(45) NULL,
      createdAt VARCHAR(32) NOT NULL,
      PRIMARY KEY (id),
      INDEX idx_appointments_master_time (masterId, time),
      CONSTRAINT fk_appointments_master
        FOREIGN KEY (masterId) REFERENCES masters(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      masterId INT NOT NULL,
      \`key\` VARCHAR(100) NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (masterId, \`key\`),
      CONSTRAINT fk_settings_master
        FOREIGN KEY (masterId) REFERENCES masters(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_settings (
      masterId INT NOT NULL,
      service VARCHAR(100) NOT NULL,
      bufferMinutes INT NOT NULL,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      PRIMARY KEY (masterId, service),
      CONSTRAINT fk_service_settings_master
        FOREIGN KEY (masterId) REFERENCES masters(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS closures (
      id INT NOT NULL AUTO_INCREMENT,
      masterId INT NOT NULL,
      start VARCHAR(32) NOT NULL,
      \`end\` VARCHAR(32) NOT NULL,
      PRIMARY KEY (id),
      INDEX idx_closures_master_start (masterId, start),
      CONSTRAINT fk_closures_master
        FOREIGN KEY (masterId) REFERENCES masters(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const name of DEFAULT_MASTERS) {
    await query('INSERT IGNORE INTO masters (name) VALUES (?)', [name]);
  }

  await ensureColumn('appointments', 'clientIp', 'clientIp VARCHAR(45) NULL AFTER note');
}

const ready = init().catch((error) => {
  console.error('MySQL veritabanı başlatılamadı:', error.message || error);
  throw error;
});

async function ensureReady() {
  await ready;
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isNaN(id) ? value : id;
}

async function getSettingValue(masterId, key) {
  await ensureReady();
  const rows = await query('SELECT value FROM settings WHERE masterId = ? AND `key` = ?', [masterId, key]);
  return rows.length ? rows[0].value : null;
}

async function setSettingValue(masterId, key, value) {
  await ensureReady();
  await query(
    `INSERT INTO settings (masterId, \`key\`, value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [masterId, key, String(value)]
  );
}

async function _getServiceBuffer(masterId, service) {
  await ensureReady();
  const rows = await query(
    'SELECT bufferMinutes FROM service_settings WHERE masterId = ? AND service = ?',
    [masterId, service]
  );
  return rows.length ? Number(rows[0].bufferMinutes) : DEFAULT_BUFFER_MINUTES;
}

async function _setServiceBuffer(masterId, service, bufferMinutes) {
  await ensureReady();
  await query(
    `INSERT INTO service_settings (masterId, service, bufferMinutes, price)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE bufferMinutes = VALUES(bufferMinutes)`,
    [masterId, service, bufferMinutes]
  );
}

module.exports = {
  ready,

  async getMasters() {
    await ensureReady();
    return query('SELECT id, name FROM masters ORDER BY id');
  },

  async getMasterById(id) {
    await ensureReady();
    const rows = await query('SELECT id, name FROM masters WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async createAppointment({ masterId, firstName, lastName, time, service, note, clientIp }) {
    await ensureReady();
    const createdAt = new Date().toISOString();
    const normalizedTime = time;
    const [result] = await pool.execute(
      `INSERT INTO appointments (masterId, firstName, lastName, time, service, note, clientIp, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [masterId, firstName, lastName, normalizedTime, service, note || null, clientIp || null, createdAt]
    );

    return {
      id: result.insertId,
      masterId,
      firstName,
      lastName,
      time: normalizedTime,
      service,
      note: note || '',
      clientIp: clientIp || null,
      createdAt
    };
  },

  async getAppointmentById(id) {
    await ensureReady();
    const rows = await query(
      'SELECT id, masterId, firstName, lastName, time, service, note, createdAt FROM appointments WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  async countFutureAppointmentsByClientIp(clientIp, fromTime) {
    await ensureReady();
    if (!clientIp) return 0;

    const rows = await query(
      `SELECT COUNT(*) AS count
       FROM appointments
       WHERE clientIp = ? AND time >= ?`,
      [clientIp, fromTime]
    );
    return Number(rows[0].count);
  },

  async countFutureAppointmentsByCustomer(firstName, lastName, fromTime) {
    await ensureReady();
    const rows = await query(
      `SELECT COUNT(*) AS count
       FROM appointments
       WHERE LOWER(firstName) = LOWER(?)
         AND LOWER(lastName) = LOWER(?)
         AND time >= ?`,
      [firstName, lastName, fromTime]
    );
    return Number(rows[0].count);
  },

  async updateAppointment(id, { masterId, firstName, lastName, time, service, note }) {
    await ensureReady();
    const [result] = await pool.execute(
      `UPDATE appointments
       SET masterId = ?, firstName = ?, lastName = ?, time = ?, service = ?, note = ?
       WHERE id = ?`,
      [masterId, firstName, lastName, time, service, note || null, id]
    );

    if (!result.affectedRows) return null;
    return { id: normalizeId(id), masterId, firstName, lastName, time, service, note: note || '' };
  },

  async deleteAppointment(id) {
    await ensureReady();
    const [result] = await pool.execute('DELETE FROM appointments WHERE id = ?', [id]);
    return { deleted: result.affectedRows };
  },

  async getAppointments(masterId) {
    await ensureReady();
    if (masterId) {
      return query(
        `SELECT id, masterId, firstName, lastName, time, service, note, createdAt
         FROM appointments
         WHERE masterId = ?
         ORDER BY time ASC`,
        [masterId]
      );
    }

    return query(
      `SELECT id, masterId, firstName, lastName, time, service, note, createdAt
       FROM appointments
       ORDER BY time ASC`
    );
  },

  async getAppointmentsByDate(date, masterId) {
    await ensureReady();
    if (masterId) {
      return query(
        `SELECT id, masterId, firstName, lastName, time, service, note, createdAt
         FROM appointments
         WHERE LEFT(time, 10) = LEFT(?, 10) AND masterId = ?
         ORDER BY time ASC`,
        [date, masterId]
      );
    }

    return query(
      `SELECT id, masterId, firstName, lastName, time, service, note, createdAt
       FROM appointments
       WHERE LEFT(time, 10) = LEFT(?, 10)
       ORDER BY time ASC`,
      [date]
    );
  },

  async getSetting(masterId, key) {
    const value = await getSettingValue(masterId, key);
    if (key === 'bufferMinutes') {
      return value ? parseInt(value, 10) : DEFAULT_BUFFER_MINUTES;
    }
    return value;
  },

  setSetting(masterId, key, value) {
    return setSettingValue(masterId, key, value);
  },

  getServiceBuffer(masterId, service) {
    return _getServiceBuffer(masterId, service);
  },

  async getServiceSettings(masterId) {
    await ensureReady();
    const rows = await query(
      'SELECT service, bufferMinutes, price FROM service_settings WHERE masterId = ?',
      [masterId]
    );

    return SERVICES.map((service) => {
      const row = rows.find((item) => item.service === service);
      return {
        service,
        bufferMinutes: row ? Number(row.bufferMinutes) : DEFAULT_BUFFER_MINUTES,
        price: row ? Number(row.price) : 0
      };
    });
  },

  async setServiceSetting(masterId, service, bufferMinutes, price) {
    await ensureReady();
    await query(
      `INSERT INTO service_settings (masterId, service, bufferMinutes, price)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bufferMinutes = VALUES(bufferMinutes),
         price = VALUES(price)`,
      [masterId, service, bufferMinutes, price]
    );
  },

  setServiceBuffer(masterId, service, minutes) {
    return _setServiceBuffer(masterId, service, minutes);
  },

  async addClosure(masterId, start, end) {
    await ensureReady();
    const [result] = await pool.execute(
      'INSERT INTO closures (masterId, start, `end`) VALUES (?, ?, ?)',
      [masterId, start, end]
    );
    return { id: result.insertId, masterId, start, end };
  },

  async getClosuresByDate(masterId, date) {
    await ensureReady();
    return query(
      `SELECT id, masterId, start, \`end\`
       FROM closures
       WHERE masterId = ? AND LEFT(start, 10) = LEFT(?, 10)
       ORDER BY start ASC`,
      [masterId, date]
    );
  },

  async deleteClosure(closureId) {
    await ensureReady();
    const [result] = await pool.execute('DELETE FROM closures WHERE id = ?', [closureId]);
    return { deleted: result.affectedRows };
  },

  async hasAppointmentConflict(masterId, requestedTime, bufferMinutes, excludeAppointmentId = null) {
    await ensureReady();
    const requested = new Date(requestedTime);
    const requestedStart = new Date(requested.getTime() - bufferMinutes * 60 * 1000);
    const requestedEnd = new Date(requested.getTime() + bufferMinutes * 60 * 1000);

    const rows = excludeAppointmentId
      ? await query(
          'SELECT id, time, service FROM appointments WHERE masterId = ? AND id <> ?',
          [masterId, excludeAppointmentId]
        )
      : await query(
          'SELECT id, time, service FROM appointments WHERE masterId = ?',
          [masterId]
        );

    for (const row of rows) {
      const existing = new Date(row.time);
      const existingBuffer = await _getServiceBuffer(masterId, row.service);
      const existingStart = new Date(existing.getTime() - existingBuffer * 60 * 1000);
      const existingEnd = new Date(existing.getTime() + existingBuffer * 60 * 1000);

      if (requestedStart < existingEnd && requestedEnd > existingStart) {
        return true;
      }
    }

    return false;
  }
};
