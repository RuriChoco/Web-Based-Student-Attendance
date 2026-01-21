const express = require('express');
const path = require('path');
const dbPromise = require('./database.js');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const PORT = 3000;
const SALT_ROUNDS = 10; // Salt rounds for bcrypt

app.use(express.json());
// Serve static files, but disable the default serving of 'index.html' for the root URL.
// This allows our custom app.get('/') route to handle it.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Configure multer for in-memory file storage
const upload = multer({ storage: multer.memoryStorage() });

let needsSetup = false; // This will be set at startup

app.use(session({ // Using default MemoryStore which requires no extra setup
    secret: 'a very secret key for attendance', // Replace with a real secret in production
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Middleware to check if the user is authenticated
const requireRole = (roles = []) => {
    return (req, res, next) => {
        if (!req.session.user || !roles.includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
};

// A simpler middleware just to check for any authenticated user
const isAuthenticated = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Not authenticated' });

// Wrapper for async routes to catch errors and pass them to the error handler
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Helper to generate student code in format YYYY-XXX where XXX is a per-year sequential padded number
// Ensures uniqueness by looping until an unused code is found and commits the used sequence number atomically.
const generateStudentCode = async (db) => {
    const year = new Date().getFullYear();
    const key = `last_student_seq_${year}`;

    // Get current sequence for this year (0 if none)
    const row = await db.get('SELECT value FROM app_meta WHERE key = ?', key);
    let seq = row ? row.value : 0;
    let candidate;

    // Find next unused sequence
    while (true) {
        seq += 1;
        const seqStr = String(seq).padStart(3, '0');
        candidate = `${year}-${seqStr}`;
        const exists = await db.get('SELECT 1 FROM student_details WHERE student_code = ?', candidate);
        if (!exists) break; // found a free code
    }

    // Update the sequence value in app_meta
    await db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, seq]);

    return candidate;
};

// Helper to generate unique session code
const generateSessionCode = async (db) => {
    let code;
    while (true) {
        code = crypto.randomBytes(3).toString('hex').toUpperCase();
        const exists = await db.get('SELECT 1 FROM attendance_sessions WHERE code = ?', code);
        if (!exists) break;
    }
    return code;
};

// --- Audit Log Helper ---
const logAction = async (userId, username, action, details = {}) => {
    try {
        const db = await dbPromise;
        const detailsJson = JSON.stringify(details);
        await db.run('INSERT INTO audit_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)', [userId, username, action, detailsJson]);
    } catch (err) {
        console.error('Failed to write to audit log:', err);
    }
};
// --- API Endpoints ---

const fs = require('fs');

// Serve icons directory at /icons
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// Handle favicon requests by serving the school icon if available, otherwise return 204
app.get('/favicon.ico', (req, res) => {
    const icoPath = path.join(__dirname, 'icons', 'school-icon.jpeg');
    if (fs.existsSync(icoPath)) {
        return res.sendFile(icoPath);
    }
    res.status(204).send();
});

// Teacher Login (using bcrypt for password hashing)
app.post('/api/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const db = await dbPromise;
    const user = await db.get(`
        SELECT u.*, sd.student_code
        FROM users u
        LEFT JOIN student_details sd ON u.id = sd.user_id
        WHERE u.username = ?
    `, username);

    if (!user) {
        await logAction(null, username, 'LOGIN_FAIL', { reason: 'User not found' });
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
        req.session.user = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            student_code: user.student_code
        };
        res.json({ success: true });
        await logAction(user.id, user.username, 'LOGIN_SUCCESS');
    } else {
        res.status(401).json({ error: 'Invalid credentials.' });
        await logAction(user.id, username, 'LOGIN_FAIL', { reason: 'Invalid password' });
    }
}));

app.post('/api/setup', asyncHandler(async (req, res) => {
    // This route should only work if no admin exists
    if (!needsSetup) {
        return res.status(403).json({ error: 'Setup has already been completed.' });
    }

    const { name, username, password } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(
        "INSERT INTO users (username, password, role, name) VALUES (?, ?, 'admin', ?)",
        [username, hashedPassword, name]
    );

    needsSetup = false; // Flip the flag now that an admin is created
    console.log('--- ADMIN ACCOUNT CREATED ---');
    console.log(`Username: ${username}`);
    console.log('Application is now in normal operating mode.');
    console.log('-----------------------------');
    res.status(201).json({ success: true, message: 'Admin account created successfully.' });
    await logAction(null, username, 'CREATE_ADMIN', { name });
}));

app.post('/api/request-password-reset', asyncHandler(async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT username FROM users WHERE username = ?', username);

    if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiry = Date.now() + 3600000; // 1 hour from now

        await db.run('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE username = ?', [token, expiry, username]);

        // --- IMPORTANT ---
        // In a real application, you would send an email here.
        // For this demo, we will log the reset link to the server console.
        const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
        console.log('--- PASSWORD RESET ---');
        console.log(`A password reset was requested for user: ${username}`);
        console.log(`Reset Link (valid for 1 hour): ${resetLink}`);
        console.log('----------------------');
        await logAction(user?.id, username, 'REQUEST_PASSWORD_RESET');
    }

    // Always send a success message to prevent username enumeration
    res.json({ message: 'If an account with that username exists, a reset link has been generated. (For this demo, check the server console for the link.)' });
}));

app.post('/api/reset-password', asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ?', [token, Date.now()]);

    if (!user) {
        return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.run('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE username = ?', [hashedPassword, user.username]);

    res.json({ message: 'Password has been reset successfully.' });
    await logAction(user.id, user.username, 'COMPLETE_PASSWORD_RESET');
}));

app.post('/api/student-setup/validate', asyncHandler(async (req, res) => {
    const { student_code } = req.body;
    if (!student_code) {
        return res.status(400).json({ error: 'Student Code is required.' });
    }

    const db = await dbPromise;
    const student = await db.get(`
        SELECT u.name, u.username
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, student_code);

    if (!student) {
        return res.status(404).json({ error: 'Student Code not found.' });
    }

    if (student.username) { // If username is not NULL, account is already set up
        return res.status(409).json({ error: 'This account has already been set up. Please log in or use "Forgot Password".' });
    }

    res.json({ success: true, name: student.name });
}));

app.post('/api/student-setup/complete', asyncHandler(async (req, res) => {
    const { student_code, username, password } = req.body;
    if (!student_code || !username || !password) {
        return res.status(400).json({ error: 'Student Code, username, and password are required.' });
    }

    const db = await dbPromise;

    // Check if the target student record is valid for setup
    const student = await db.get(`
        SELECT u.id, u.username
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, student_code);
    if (!student || student.username) {
        return res.status(403).json({ error: 'This account is not eligible for setup.' });
    }

    // Check if the desired username is already taken by anyone
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existingUser) {
        return res.status(409).json({ error: 'This username is already taken. Please choose another.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(
        'UPDATE users SET username = ?, password = ? WHERE id = ?',
        [username, hashedPassword, student.id]
    );

    res.status(200).json({ success: true, message: 'Account setup complete! You can now log in.' });
}));

app.post('/api/logout', async (req, res, next) => {
    if (req.session.user) {
        await logAction(req.session.user.id, req.session.user.username, 'LOGOUT');
    }
    req.session.destroy((err) => {
        if (err) {
            // If there's an error destroying the session, pass it to the error handler
            return next(err);
        }
        // The session cookie is typically cleared automatically by `destroy`. We can send a no-content response to signify success.
        res.status(204).send();
    });
});

// Endpoint for the frontend to check session status
app.get('/api/session', (req, res) => {
    if (needsSetup) {
        // If in setup mode, always report as unauthenticated
        // and include a flag for the client to redirect.
        return res.json({ authenticated: false, needsSetup: true });
    }
    if (req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// Student Management (now protected)
app.get('/api/students', isAuthenticated, asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // Default to 10 students per page
    const search = req.query.search || '';
    const courseId = req.query.course_id || '';
    const yearLevel = req.query.year_level || '';
    const offset = (page - 1) * limit;

    try {
        const db = await dbPromise;
        const searchTerm = `%${search}%`;

        let whereClause = "u.role = 'student' AND u.name LIKE ?";
        let params = [searchTerm];

        if (yearLevel) {
            whereClause += " AND sd.year_level = ?";
            params.push(yearLevel);
        }

        if (courseId) {
            whereClause += " AND EXISTS (SELECT 1 FROM student_courses sc WHERE sc.user_id = u.id AND sc.course_id = ?)";
            params.push(courseId);
        }

        // Get total count for pagination, considering the search term
        const totalResult = await db.get(
            `SELECT COUNT(*) as count FROM users u JOIN student_details sd ON u.id = sd.user_id WHERE ${whereClause}`,
            params
        );
        const totalStudents = totalResult.count;
        const totalPages = Math.ceil(totalStudents / limit);

        // Get students for the current page
        const students = await db.all(
            `SELECT u.username, u.name, sd.student_code, sd.age, sd.gender, sd.year_level
             FROM users u
             JOIN student_details sd ON u.id = sd.user_id
             WHERE ${whereClause}
             ORDER BY sd.student_code LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, data: {
            students,
            pagination: {
                currentPage: page,
                totalPages,
                totalStudents,
            },
        }});
    } catch (err) {
        // This catch is now handled by the asyncHandler wrapper
        throw err;
    }
}));

app.post('/api/students', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    const { name, age, gender, year_level, student_code: manualCode } = req.body;
    if (!name || !age || !gender) {
        return res.status(400).json({ error: 'Name, age, and gender are required.' });
    }

    const db = await dbPromise;
    await db.run('BEGIN IMMEDIATE');
    try {
        let studentCode = manualCode ? manualCode.trim() : null;

        if (studentCode) {
            // Check if manual code is already taken
            const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', studentCode);
            if (existing) {
                await db.run('ROLLBACK');
                return res.status(409).json({ error: 'This Student Code is already in use.' });
            }
        } else {
                // Generate a new code with year-prefix and per-year sequence
                studentCode = await generateStudentCode(db);
        }

        // 1. Insert into users table
        const userResult = await db.run(
            "INSERT INTO users (role, name) VALUES ('student', ?)",
            [name]
        );
        const userId = userResult.lastID;

        // 2. Insert into student_details table
        await db.run(
            "INSERT INTO student_details (user_id, student_code, age, gender, year_level) VALUES (?, ?, ?, ?, ?)",
            [userId, studentCode, age, gender, year_level || null]
        );

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'CREATE_STUDENT', { student_code: studentCode, name });
        res.status(201).json({ ...req.body, id: userId, student_code: studentCode });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.delete('/api/students/:code', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const student = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', req.params.code);
        if (!student) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        const result = await db.run('DELETE FROM users WHERE id = ?', student.user_id);
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'DELETE_STUDENT', { student_code: req.params.code });
            res.json({ message: 'Student deleted successfully.' });
        } else {
            res.status(404).json({ error: 'Student not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.put('/api/students/:code', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    const { code } = req.params;
    const { name, age, gender, year_level, student_code: newStudentCode } = req.body;

    if (!name || !age || !gender) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;
    try {
        await db.run('BEGIN');

        const student = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', code);
        if (!student) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Student not found.' });
        }

        // Update the two tables
        await db.run('UPDATE users SET name = ? WHERE id = ?', [name, student.user_id]);

        // If a new student code is provided, update it.
        if (newStudentCode && newStudentCode !== code) {
            const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', newStudentCode);
            if (existing) {
                await db.run('ROLLBACK');
                return res.status(409).json({ error: 'The new Student Code is already in use.' });
            }
            await db.run('UPDATE student_details SET student_code = ?, age = ?, gender = ?, year_level = ? WHERE user_id = ?', [newStudentCode, age, gender, year_level || null, student.user_id]);
        } else {
            await db.run('UPDATE student_details SET age = ?, gender = ?, year_level = ? WHERE user_id = ?', [age, gender, year_level || null, student.user_id]);
        }

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'UPDATE_STUDENT', { student_code: code, name });
        res.json({ message: 'Student updated successfully.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.post('/api/students/upload-csv', requireRole(['admin', 'registrar']), upload.single('studentCsv'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No CSV file uploaded.' });
    }

    const db = await dbPromise;
    const results = [];
    const errors = [];

    // Create a readable stream from the buffer provided by multer's memoryStorage
    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    bufferStream.pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            let successfulUploads = 0;

            for (const student of results) {
                const { name, age, gender, student_code: manualCode } = student;

                // Basic validation for required fields in the CSV row
                if (!name || !age || !gender) {
                    errors.push({ student: name || 'Unknown Row', error: 'Missing required fields (name, age, gender).' });
                    continue;
                }

                await db.run('BEGIN IMMEDIATE');
                try {
                    let studentCode = manualCode ? manualCode.trim() : null;

                    if (studentCode) {
                        const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', studentCode);
                        if (existing) {
                            throw new Error(`Student Code ${studentCode} is already in use.`);
                        }
                    } else {
                        // Generate a per-year student code like YYYY-XXX
                        studentCode = await generateStudentCode(db);
                    }

                    const userResult = await db.run("INSERT INTO users (role, name) VALUES ('student', ?)", [name]);
                    const userId = userResult.lastID;

                    await db.run("INSERT INTO student_details (user_id, student_code, age, gender) VALUES (?, ?, ?, ?)", [userId, studentCode, age, gender]);
                    await db.run('COMMIT');
                    successfulUploads++;
                    await logAction(req.session.user.id, req.session.user.username, 'BULK_CREATE_STUDENT', { student_code: studentCode, name });
                } catch (err) {
                    await db.run('ROLLBACK');
                    errors.push({ student: name, error: err.message });
                }
            }

            res.json({ message: `Bulk upload complete. Successfully added ${successfulUploads} of ${results.length} students.`, errors, totalRows: results.length });
        });
}));

// --- Staff Management (Admin Only) ---
app.use('/api/staff', requireRole(['admin']));

app.get('/api/staff', asyncHandler(async (req, res) => {
    const db = await dbPromise;
    // Get all users who are not students or the current admin to prevent self-deletion in UI
    const staff = await db.all(
        "SELECT id, username, name, role FROM users WHERE role IN ('registrar', 'teacher') ORDER BY name"
    );
    res.json({ success: true, data: staff });
}));

app.post('/api/staff', asyncHandler(async (req, res) => {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role) {
        return res.status(400).json({ error: 'Name, username, password, and role are required.' });
    }
    if (!['teacher', 'registrar'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
    }

    const db = await dbPromise;
    // Check if username is taken
    const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existing) {
        return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await db.run(
        'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
        [name, username, hashedPassword, role]
    );

    await logAction(req.session.user.id, req.session.user.username, 'CREATE_STAFF', { new_user_id: result.lastID, new_username: username, role });
    res.status(201).json({ id: result.lastID, message: 'Staff user created.' });
}));

app.delete('/api/staff/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run("DELETE FROM users WHERE id = ? AND role IN ('teacher', 'registrar')", id);

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_STAFF', { deleted_user_id: id });
        res.json({ message: 'Staff user deleted successfully.' });
    } else {
        res.status(404).json({ error: 'Staff user not found or you are not allowed to delete this user.' });
    }
}));

app.post('/api/staff/:id/reset-password', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', id);

    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000; // 1 hour

    await db.run('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [token, expiry, id]);

    const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
    console.log('--- ADMIN-INITIATED PASSWORD RESET ---');
    console.log(`Reset link generated for user: ${user.username} (ID: ${user.id})`);
    console.log(`Link (valid for 1 hour): ${resetLink}`);
    console.log('------------------------------------');

    await logAction(req.session.user.id, req.session.user.username, 'ADMIN_RESET_PASSWORD', { target_user_id: user.id, target_username: user.username });
    res.json({ message: `Password reset link for ${user.username} has been generated.`, resetLink });
}));

// --- Room Management ---

app.get('/api/rooms', isAuthenticated, asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const rooms = await db.all('SELECT * FROM rooms ORDER BY name');
    res.json({ success: true, data: rooms });
}));

app.get('/api/rooms/:id/schedule', isAuthenticated, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const courses = await db.all(`
        SELECT code, name, start_time, end_time, days
        FROM courses
        WHERE room_id = ?
    `, id);
    res.json({ success: true, data: courses });
}));

app.post('/api/rooms', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { name, room_number } = req.body;
    if (!name || !room_number) return res.status(400).json({ error: 'Room name and number are required.' });

    const db = await dbPromise;

    const existing = await db.get('SELECT id FROM rooms WHERE name = ? AND room_number = ?', [name, room_number]);
    if (existing) {
        return res.status(409).json({ error: 'A room with this name and number already exists.' });
    }

    try {
        const result = await db.run('INSERT INTO rooms (name, room_number) VALUES (?, ?)', [name, room_number]);
        await logAction(req.session.user.id, req.session.user.username, 'CREATE_ROOM', { name, room_number });
        res.status(201).json({ success: true, id: result.lastID, name, room_number });
    } catch (err) {
        throw err;
    }
}));

app.put('/api/rooms/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, room_number } = req.body;
    if (!name || !room_number) return res.status(400).json({ error: 'Room name and number are required.' });

    const db = await dbPromise;

    const existing = await db.get('SELECT id FROM rooms WHERE name = ? AND room_number = ? AND id != ?', [name, room_number, id]);
    if (existing) {
        return res.status(409).json({ error: 'A room with this name and number already exists.' });
    }

    try {
        const result = await db.run('UPDATE rooms SET name = ?, room_number = ? WHERE id = ?', [name, room_number, id]);
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'UPDATE_ROOM', { id, name, room_number });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Room not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.delete('/api/rooms/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run('DELETE FROM rooms WHERE id = ?', id);
    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_ROOM', { id });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Room not found.' });
    }
}));

// --- Course Management ---

app.get('/api/courses', isAuthenticated, asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const courses = await db.all(`
        SELECT c.*, r.name as room_name, r.room_number 
        FROM courses c 
        LEFT JOIN rooms r ON c.room_id = r.id 
        ORDER BY c.code
    `);
    res.json({ success: true, data: courses });
}));

// Helper to check for schedule conflicts
const checkScheduleConflict = async (db, roomId, startTime, endTime, days, excludeCourseId = null) => {
    if (!roomId || !startTime || !endTime || !days) return false;

    let query = 'SELECT id, name, start_time, end_time, days FROM courses WHERE room_id = ?';
    const params = [roomId];

    if (excludeCourseId) {
        query += ' AND id != ?';
        params.push(excludeCourseId);
    }

    const existingCourses = await db.all(query, params);
    const newDays = days.split(',');

    for (const course of existingCourses) {
        if (!course.start_time || !course.end_time || !course.days) continue;

        const existingDays = course.days.split(',');
        const daysOverlap = newDays.some(day => existingDays.includes(day));

        if (daysOverlap) {
            // Check time overlap: (StartA < EndB) and (EndA > StartB)
            if (startTime < course.end_time && endTime > course.start_time) {
                return true; // Conflict found
            }
        }
    }
    return false;
};

app.post('/api/courses', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { code, name, room_id, start_time, end_time, days } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Course code and name are required.' });

    const db = await dbPromise;

    const existing = await db.get('SELECT id FROM courses WHERE code = ?', [code]);
    if (existing) {
        return res.status(409).json({ error: 'A course with this code already exists.' });
    }

    if (room_id && start_time && end_time && days) {
        const hasConflict = await checkScheduleConflict(db, room_id, start_time, end_time, days);
        if (hasConflict) {
            return res.status(409).json({ error: 'Schedule conflict: The selected room is already booked for this time.' });
        }
    }

    try {
        const result = await db.run(
            'INSERT INTO courses (code, name, room_id, start_time, end_time, days) VALUES (?, ?, ?, ?, ?, ?)',
            [code, name, room_id || null, start_time || null, end_time || null, days || null]
        );
        await logAction(req.session.user.id, req.session.user.username, 'CREATE_COURSE', { code, name, room_id, start_time, end_time, days });
        res.status(201).json({ success: true, id: result.lastID, code, name, room_id });
    } catch (err) {
        throw err;
    }
}));

app.put('/api/courses/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { code, name, room_id, start_time, end_time, days } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Course code and name are required.' });

    const db = await dbPromise;

    const existing = await db.get('SELECT id FROM courses WHERE code = ? AND id != ?', [code, id]);
    if (existing) {
        return res.status(409).json({ error: 'A course with this code already exists.' });
    }

    if (room_id && start_time && end_time && days) {
        const hasConflict = await checkScheduleConflict(db, room_id, start_time, end_time, days, id);
        if (hasConflict) {
            return res.status(409).json({ error: 'Schedule conflict: The selected room is already booked for this time.' });
        }
    }

    try {
        const result = await db.run(
            'UPDATE courses SET code = ?, name = ?, room_id = ?, start_time = ?, end_time = ?, days = ? WHERE id = ?',
            [code, name, room_id || null, start_time || null, end_time || null, days || null, id]
        );
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'UPDATE_COURSE', { id, code, name, room_id, start_time, end_time, days });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Course not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.delete('/api/courses/:id', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run('DELETE FROM courses WHERE id = ?', id);
    if (result.changes > 0) {
        await db.run('DELETE FROM student_courses WHERE course_id = ?', id); // Cleanup enrollments
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_COURSE', { id });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Course not found.' });
    }
}));

app.get('/api/public/courses', asyncHandler(async (req, res) => {
    const db = await dbPromise;
    // Public endpoint for signup form, only select necessary fields
    const courses = await db.all('SELECT id, code, name FROM courses ORDER BY code');
    res.json({ success: true, data: courses });
}));

// --- Enrollment Management ---

app.get('/api/courses/:id/students', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const search = req.query.search || '';
    const db = await dbPromise;

    // Return all students with a flag indicating if they are enrolled in the course
    const students = await db.all(`
        SELECT u.id as user_id, u.name, sd.student_code,
               CASE WHEN sc.course_id IS NOT NULL THEN 1 ELSE 0 END as is_enrolled
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        LEFT JOIN student_courses sc ON u.id = sc.user_id AND sc.course_id = ?
        WHERE u.role = 'student' AND (u.name LIKE ? OR sd.student_code LIKE ?)
        ORDER BY is_enrolled DESC, u.name
    `, [id, `%${search}%`, `%${search}%`]);

    res.json({ success: true, data: students });
}));

app.post('/api/courses/:id/enroll', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body;
    const db = await dbPromise;
    await db.run('INSERT OR IGNORE INTO student_courses (user_id, course_id) VALUES (?, ?)', [student_id, id]);
    await logAction(req.session.user.id, req.session.user.username, 'ENROLL_STUDENT', { course_id: id, student_id });
    res.json({ success: true });
}));

app.post('/api/courses/:id/unenroll', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body;
    const db = await dbPromise;
    await db.run('DELETE FROM student_courses WHERE user_id = ? AND course_id = ?', [student_id, id]);
    await logAction(req.session.user.id, req.session.user.username, 'UNENROLL_STUDENT', { course_id: id, student_id });
    res.json({ success: true });
}));

// --- Student History ---
app.get('/api/students-list', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const students = await db.all(`
        SELECT u.name, sd.student_code
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE u.role = 'student'
        ORDER BY u.name
    `);
    res.json({ success: true, data: students });
}));

app.get('/api/student-history', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { student_code, startDate, endDate } = req.query;
    if (!student_code || !startDate || !endDate) {
        return res.status(400).json({ error: 'Student, start date, and end date are required.' });
    }
    const db = await dbPromise;
    const records = await db.all(`
        SELECT a.date, a.time, a.status
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND a.date BETWEEN ? AND ?
        ORDER BY a.date DESC
    `, [student_code, startDate, endDate]);
    res.json({ success: true, data: records });
}));

// --- Student Profile ---
app.get('/api/student-profile/:student_code', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { student_code } = req.params;
    const db = await dbPromise;

    // 1. Get student details
    const student = await db.get(`
        SELECT u.id, u.name, sd.student_code, sd.age, sd.gender
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ?
    `, student_code);

    if (!student) {
        return res.status(404).json({ error: 'Student not found.' });
    }

    const { id: userId, ...details } = student;

    // 2. Get last 30 days of attendance
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const attendance = await db.all(`
        SELECT date, time, status
        FROM attendance
        WHERE user_id = ? AND date BETWEEN ? AND ?
        ORDER BY date DESC
    `, [userId, startDate, today]);

    // 3. Get all excuses
    const excuses = await db.all(`
        SELECT date, reason, status
        FROM excuses
        WHERE user_id = ?
        ORDER BY date DESC
    `, userId);

    res.json({ success: true, data: { details, attendance, excuses } });
}));

// --- Dashboard Summary ---
app.get('/api/dashboard-summary', isAuthenticated, asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const today = new Date().toISOString().split('T')[0];

    // 1. Total students
    const totalStudentsResult = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'student'");
    const totalStudents = totalStudentsResult.count;

    // 2. Pending excuses
    const pendingExcusesResult = await db.get("SELECT COUNT(*) as count FROM excuses WHERE status = 'Pending'");
    const pendingExcuses = pendingExcusesResult.count;

    // 3. Today's attendance summary
    // First, ensure today's attendance records exist.
    const allStudents = await db.all("SELECT id FROM users WHERE role = 'student'");
    if (allStudents.length > 0) {
        const studentsWithRecords = await db.all('SELECT user_id FROM attendance WHERE date = ?', today);
        const studentsWithRecordsIds = new Set(studentsWithRecords.map(r => r.user_id));
        const missingStudents = allStudents.filter(s => !studentsWithRecordsIds.has(s.id));

        if (missingStudents.length > 0) {
            await db.run('BEGIN IMMEDIATE');
            try {
                const stmt = await db.prepare('INSERT OR IGNORE INTO attendance (user_id, date, time, status) VALUES (?, ?, ?, ?)');
                for (const student of missingStudents) {
                    await stmt.run(student.id, today, '--', 'Absent');
                }
                await stmt.finalize();
                await db.run('COMMIT');
            } catch (err) {
                await db.run('ROLLBACK');
                throw err;
            }
        }
    }

    const attendanceRows = await db.all(
        `SELECT status, COUNT(status) as count FROM attendance WHERE date = ? GROUP BY status`,
        [today]
    );

    const todaysSummary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
    attendanceRows.forEach(row => {
        if (todaysSummary.hasOwnProperty(row.status)) {
            todaysSummary[row.status] = row.count;
        }
    });

    res.json({ success: true, data: {
        totalStudents,
        pendingExcuses,
        todaysSummary
    }});
}));
// --- PUBLIC API Endpoints (Student and Teacher) ---

app.get('/api/attendance/sessions', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const db = await dbPromise;
    // Limit to recent 20 sessions for performance
    const sessions = await db.all(`
        SELECT s.id, s.date, s.start_time, s.end_time, s.code, s.room_id,
               c.id as course_id, c.name as course_name, c.code as course_code,
               r.name as room_name, r.room_number,
               u.name as creator_name,
               (SELECT COUNT(*) FROM attendance a WHERE a.course_id = s.course_id AND a.date = s.date AND (a.status = 'Present' OR a.status = 'Late')) as present_count,
               (SELECT COUNT(*) FROM attendance a WHERE a.course_id = s.course_id AND a.date = s.date AND a.status = 'Absent') as absent_count
        FROM attendance_sessions s
        JOIN courses c ON s.course_id = c.id
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN users u ON s.created_by = u.id
        ORDER BY s.date DESC, s.start_time DESC
        LIMIT 20
    `);
    res.json({ success: true, data: sessions });
}));

app.put('/api/attendance/sessions/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { start_time, end_time } = req.body;

    if (!start_time) {
        return res.status(400).json({ error: 'Start time is required.' });
    }

    const db = await dbPromise;
    const session = await db.get('SELECT * FROM attendance_sessions WHERE id = ?', id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    await db.run('UPDATE attendance_sessions SET start_time = ?, end_time = ? WHERE id = ?', [start_time, end_time || null, id]);
    
    await logAction(req.session.user.id, req.session.user.username, 'UPDATE_ATTENDANCE_SESSION', { session_id: id, start_time, end_time });
    res.json({ success: true, message: 'Session updated.' });
}));

app.delete('/api/attendance/sessions/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    
    const session = await db.get('SELECT * FROM attendance_sessions WHERE id = ?', id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    await db.run('BEGIN IMMEDIATE');
    try {
        await db.run('DELETE FROM attendance_sessions WHERE id = ?', id);
        await db.run('DELETE FROM attendance WHERE course_id = ? AND date = ?', [session.course_id, session.date]);
        await db.run('COMMIT');
        
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_ATTENDANCE_SESSION', { session_id: id, code: session.code });
        res.json({ success: true, message: 'Session deleted.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.get('/api/attendance/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    let { course_id, year_level, room_id } = req.query;

    // Ensure IDs are integers for correct DB comparison
    if (course_id) course_id = parseInt(course_id);
    if (room_id) room_id = parseInt(room_id);

    if (!course_id && !room_id) {
        return res.status(400).json({ error: 'Course ID or Room ID is required.' });
    }

    const db = await dbPromise;
    try {
        // 1. Identify target courses to ensure attendance records exist
        let targetCourseIds = [];
        if (course_id) {
            targetCourseIds = [course_id];
        } else if (room_id) {
            // Find all courses effectively in this room on this date
            const coursesInRoom = await db.all(`
                SELECT c.id 
                FROM courses c
                LEFT JOIN attendance_sessions s ON c.id = s.course_id AND s.date = ?
                WHERE (s.room_id = ? OR (s.room_id IS NULL AND c.room_id = ?))
            `, [date, room_id, room_id]);
            targetCourseIds = coursesInRoom.map(c => c.id);
        }

        if (targetCourseIds.length > 0) {
            await db.run('BEGIN IMMEDIATE');
            const stmt = await db.prepare('INSERT OR IGNORE INTO attendance (user_id, course_id, date, time, status) VALUES (?, ?, ?, ?, ?)');
            
            for (const cid of targetCourseIds) {
                const enrolledStudents = await db.all("SELECT user_id FROM student_courses WHERE course_id = ?", cid);
                for (const student of enrolledStudents) {
                    await stmt.run(student.user_id, cid, date, '--', 'Absent');
                }
            }
            await stmt.finalize();
            await db.run('COMMIT');
        }

        // Now, fetch the complete list which is guaranteed to be populated
        let query = `
            SELECT a.id, a.date, a.time, a.status, sd.student_code, u.name, sd.year_level, 
                   COALESCE(s.room_id, c.room_id) as room_id,
                   c.code as course_code
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            JOIN student_details sd ON u.id = sd.user_id
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN attendance_sessions s ON a.course_id = s.course_id AND a.date = s.date
            WHERE a.date = ?
        `;
        const params = [date];

        if (course_id) {
            query += ' AND a.course_id = ?';
            params.push(course_id);
        }

        if (room_id) {
            // Filter by effective room (session room takes precedence over course default room)
            query += ' AND (s.room_id = ? OR (s.room_id IS NULL AND c.room_id = ?))';
            params.push(room_id, room_id);
        }

        if (year_level) {
            query += ' AND sd.year_level = ?';
            params.push(year_level);
        }

        query += ' ORDER BY c.code, sd.student_code';
        const attendanceList = await db.all(query, params);

        res.json({ success: true, data: attendanceList });
    } catch (err) {
        // In case of error during transaction, attempt a rollback
        try { await db.run('ROLLBACK'); } catch (e) { /* ignore if no transaction was active */ }
        throw err;
    }
}));

app.put('/api/attendance', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    let { date, student_code, status, course_id, session_start_time } = req.body;
    if (!date || !student_code || !status || !course_id) {
        return res.status(400).json({ error: 'Date, student code, course ID, and status are required.' });
    }
    try {
        const db = await dbPromise;
        const now = new Date();
        const time = (status === 'Present' || status === 'Late') 
            ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
            : '--';
        
        // Logic: If marked Present > 15 mins after start time, record as Late.
        if (status === 'Present') {
            let startH, startM;

            if (session_start_time) {
                [startH, startM] = session_start_time.split(':').map(Number);
            } else {
                const course = await db.get('SELECT start_time FROM courses WHERE id = ?', course_id);
                if (course && course.start_time) [startH, startM] = course.start_time.split(':').map(Number);
            }

            if (startH !== undefined) {
                const startTimeDate = new Date();
                startTimeDate.setHours(startH, startM, 0, 0);

                // Add 15 minutes to start time
                const lateThreshold = new Date(startTimeDate.getTime() + 15 * 60000);
                
                // Compare only times (ignoring date part of 'now' vs 'startTimeDate' if they differ in day, 
                // but here we assume attendance is taken on the day. 
                // Actually, 'now' is the current server time. 
                // If the teacher is updating attendance for a PAST date, we shouldn't auto-mark Late based on current time.
                // So we only apply this logic if the attendance date matches today.
                const todayStr = now.toISOString().split('T')[0];
                
                if (date === todayStr && now > lateThreshold) {
                    status = 'Late';
                }
            }
        }

        const user = await db.get(`
            SELECT u.id FROM users u
            JOIN student_details sd ON u.id = sd.user_id
            WHERE sd.student_code = ?
        `, student_code);
        if (!user) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        const result = await db.run('UPDATE attendance SET status = ?, time = ? WHERE date = ? AND user_id = ? AND course_id = ?', [status, time, date, user.id, course_id]);

        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'UPDATE_ATTENDANCE', { student_code, date, status, course_id });
            res.json({ message: 'Attendance updated.' });
        } else {
            res.status(404).json({ error: 'Attendance record not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

// --- Attendance Session (Code Generation) ---

app.post('/api/attendance/session', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { course_id, date, start_time, end_time, room_id } = req.body;
    if (!course_id || !date || !start_time) {
        return res.status(400).json({ error: 'Course, date, and start time are required.' });
    }

    const db = await dbPromise;
    
    // Check if session exists for this course and date
    const existing = await db.get('SELECT code FROM attendance_sessions WHERE course_id = ? AND date = ?', [course_id, date]);
    if (existing) {
        // Update start time if changed, return existing code
        await db.run('UPDATE attendance_sessions SET start_time = ?, end_time = ?, room_id = ? WHERE course_id = ? AND date = ?', [start_time, end_time || null, room_id || null, course_id, date]);
        return res.json({ success: true, code: existing.code });
    }

    const code = await generateSessionCode(db);
    await db.run('INSERT INTO attendance_sessions (course_id, date, code, start_time, end_time, room_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [course_id, date, code, start_time, end_time || null, room_id || null, req.session.user.id]);
    
    await logAction(req.session.user.id, req.session.user.username, 'CREATE_ATTENDANCE_SESSION', { course_id, date, code, room_id, end_time });
    res.json({ success: true, code });
}));

app.post('/api/student/attendance/mark', requireRole(['student']), asyncHandler(async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    const db = await dbPromise;
    const session = await db.get('SELECT * FROM attendance_sessions WHERE code = ?', code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: 'Invalid attendance code.' });
    }

    const today = new Date().toISOString().split('T')[0];
    if (session.date !== today) {
         return res.status(400).json({ error: 'This attendance code is not for today.' });
    }

    // Calculate Status
    const now = new Date();
    const [startH, startM] = session.start_time.split(':').map(Number);
    const startTimeDate = new Date();
    startTimeDate.setHours(startH, startM, 0, 0);
    
    // 15 mins threshold
    const lateThreshold = new Date(startTimeDate.getTime() + 15 * 60000);
    const status = now > lateThreshold ? 'Late' : 'Present';
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Upsert Attendance
    await db.run(`
        INSERT INTO attendance (user_id, course_id, date, time, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, course_id, date) DO UPDATE SET
        time = excluded.time,
        status = excluded.status
    `, [req.session.user.id, session.course_id, session.date, timeStr, status]);

    res.json({ success: true, message: `Attendance marked as ${status}.` });
}));

// Export attendance to CSV
app.get('/api/attendance/:date/csv', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { date } = req.params;
    const { course_id } = req.query;
    if (!course_id) {
        return res.status(400).send('Course ID is required');
    }
    try {
        const db = await dbPromise;
        const records = await db.all(`
            SELECT sd.student_code, u.name, a.time, a.status, r.name as room_name, r.room_number
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            JOIN student_details sd ON u.id = sd.user_id
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN rooms r ON c.room_id = r.id
            WHERE a.date = ? AND a.course_id = ? ORDER BY sd.student_code
        `, [date, course_id]);

        if (records.length === 0) {
            // Send a CSV with only headers if no records are found
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
            return res.status(200).send('"Code","Name","Time","Status","Room Name","Room Number"\n');
        }

        // CSV header
        const csvHeader = '"Code","Name","Time","Status","Room Name","Room Number"\n';
        // CSV rows
        const csvRows = records.map(r => `"${r.student_code}","${r.name}","${r.time}","${r.status}","${r.room_name || ''}","${r.room_number || ''}"`).join('\n');

        const csvData = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
        res.status(200).send(csvData);
    } catch (err) {
        throw err;
    }
}));

// Excuse Management (viewing pending is protected)
app.get('/api/excuses', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const excuses = await db.all(`
            SELECT e.id, e.date, e.reason, e.status, sd.student_code, u.name
            FROM excuses e
            JOIN users u ON u.id = e.user_id
            JOIN student_details sd ON u.id = sd.user_id
            WHERE e.status = 'Pending'
        `);
        res.json({ success: true, data: excuses });
    } catch (err) {
        throw err;
    }
}));

app.get('/api/excuses/history', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const excuses = await db.all(`
            SELECT e.id, e.date, e.reason, e.status, sd.student_code, u.name as student_name, p.name as processor_name
            FROM excuses e
            JOIN users u ON u.id = e.user_id
            JOIN student_details sd ON u.id = sd.user_id
            LEFT JOIN users p ON e.processed_by = p.id
            WHERE e.status != 'Pending'
            ORDER BY e.date DESC
            LIMIT 50
        `);
        res.json({ success: true, data: excuses });
    } catch (err) {
        throw err;
    }
}));

// This route is now replaced by the student-specific one below
/*
app.post('/api/excuses', requireRole(['student']), async (req, res) => {
    const { code, reason, date } = req.body;
    if (!code || !reason || !date) {
        return res.status(400).json({ error: 'Student code, date, and reason are required.' });
    }

    // Server-side validation to prevent submitting for past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const excuseDate = new Date(date);

    if (excuseDate < today) {
        return res.status(400).json({ error: 'Cannot submit an excuse for a past date.' });
    }

    try {
        const db = await dbPromise;
        const student = await db.get("SELECT name FROM users WHERE student_code = ? AND role = 'student'", req.session.user.student_code);
        if (!student) {
            return res.status(404).json({ error: 'Student code not found.' });
        }
        const result = await db.run('INSERT INTO excuses (student_code, name, date, reason) VALUES (?, ?, ?, ?)', [req.session.user.student_code, req.session.user.name, date, reason]);
        res.status(201).json({ id: result.lastID, message: 'Excuse submitted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
*/

// Approving/denying is protected
app.put('/api/excuses/:id/approve', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    try {
        const excuse = await db.get('SELECT user_id, date FROM excuses WHERE id = ?', id);
        if (!excuse) {
            return res.status(404).json({ error: 'Excuse not found.' });
        }

        // Use the date from the excuse record itself, not from the request body
        const { user_id, date } = excuse;

        await db.run('BEGIN');
        await db.run("UPDATE excuses SET status = 'Approved', processed_by = ? WHERE id = ?", [req.session.user.id, id]);
        // Note: Excuses are currently global (daily), not per course.
        // We might need to update attendance for ALL courses for that student on that day.
        await db.run(`
            UPDATE attendance SET status = 'Excused', time = '--'
            WHERE user_id = ? AND date = ?
        `, [user_id, date]); // This updates all course attendance for that day
        await db.run('COMMIT');

        await logAction(req.session.user.id, req.session.user.username, 'APPROVE_EXCUSE', { excuse_id: id, student_user_id: user_id });
        res.json({ message: 'Excuse approved and attendance updated.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.put('/api/excuses/:id/deny', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const result = await db.run("UPDATE excuses SET status = 'Denied', processed_by = ? WHERE id = ?", [req.session.user.id, req.params.id]);
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'DENY_EXCUSE', { excuse_id: req.params.id });
            res.json({ message: 'Excuse denied.' });
        } else {
            res.status(404).json({ error: 'Excuse not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.put('/api/excuses/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason, date } = req.body;
    if (!reason || !date) {
        return res.status(400).json({ error: 'Reason and date are required.' });
    }

    const db = await dbPromise;
    // Only allow updating excuses that are still 'Pending'
    const result = await db.run(
        "UPDATE excuses SET reason = ?, date = ? WHERE id = ? AND status = 'Pending'",
        [reason, date, id]
    );

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'UPDATE_EXCUSE', { excuse_id: id, new_date: date });
        res.json({ message: 'Excuse updated successfully.' });
    } else {
        res.status(404).json({ error: 'Excuse not found or it has already been processed.' });
    }
}));

app.delete('/api/excuses/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run("DELETE FROM excuses WHERE id = ?", id);

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_EXCUSE', { excuse_id: id });
        res.json({ message: 'Excuse deleted successfully.' });
    } else {
        res.status(404).json({ error: 'Excuse not found.' });
    }
}));

// Get attendance summary for a student (public)
app.get('/api/summary/:student_code', asyncHandler(async (req, res) => {
    const { student_code } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ error: 'Start and end dates are required.' });
    }

    try {
        const db = await dbPromise;

        const student = await db.get(`
            SELECT u.id, u.name, sd.student_code FROM users u
            JOIN student_details sd ON u.id = sd.user_id
            WHERE sd.student_code = ? AND u.role = 'student'
        `, student_code);

        if (!student) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        const rows = await db.all(
            `SELECT status, COUNT(status) as count
             FROM attendance
             WHERE user_id = ? AND date BETWEEN ? AND ?
             GROUP BY status`,
            [student.id, start, end]
        );

        const summary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };

        rows.forEach(row => {
            if (summary.hasOwnProperty(row.status)) {
                summary[row.status] = row.count;
            }
        });

        res.json({ success: true, data: { name: student.name, student_code: student.student_code, summary } });
    } catch (err) {
        throw err;
    }
}));

// New public endpoint to validate a student code and get their name
app.get('/api/public/student/:code', asyncHandler(async (req, res) => {
    const { code } = req.params;
    const db = await dbPromise;
    const student = await db.get(`
        SELECT u.name, sd.student_code
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, code);
    if (student) {
        res.json({ success: true, data: student });
    } else {
        res.status(404).json({ error: 'Student code not found.' });
    }
}));

// --- Student-Specific Protected API Endpoints ---
app.use('/api/student', requireRole(['student']));

app.get('/api/student/excuses', asyncHandler(async (req, res) => {
    const { id: user_id } = req.session.user;
    const db = await dbPromise;
    const excuses = await db.all('SELECT * FROM excuses WHERE user_id = ? ORDER BY date DESC', user_id);
    res.json({ success: true, data: excuses });
}));

app.get('/api/student/attendance-history', asyncHandler(async (req, res) => {
    const { id: user_id } = req.session.user;
    const db = await dbPromise;
    const records = await db.all(`
        SELECT a.date, a.time, a.status, c.code, c.name, u.name as teacher_name,
               COALESCE(sr.name, cr.name) as room_name,
               COALESCE(sr.room_number, cr.room_number) as room_number
        FROM attendance a
        LEFT JOIN courses c ON a.course_id = c.id
        LEFT JOIN rooms cr ON c.room_id = cr.id
        LEFT JOIN attendance_sessions s ON a.course_id = s.course_id AND a.date = s.date
        LEFT JOIN rooms sr ON s.room_id = sr.id
        LEFT JOIN users u ON s.created_by = u.id
        WHERE a.user_id = ?
        ORDER BY a.date DESC
    `, user_id);
    res.json({ success: true, data: records });
}));

app.post('/api/student/excuse', asyncHandler(async (req, res) => {
    const { reason, date } = req.body;
    const { id: user_id } = req.session.user;

    if (!reason || !date) {
        return res.status(400).json({ error: 'Date and reason are required.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date) < today) {
        return res.status(400).json({ error: 'Cannot submit an excuse for a past date.' });
    }

    const db = await dbPromise;
    // Use INSERT ON CONFLICT to allow students to update their excuse reason if it's still pending.
    // This prevents duplicate excuses for the same day and handles the new UNIQUE constraint.
    const result = await db.run(`
        INSERT INTO excuses (user_id, date, reason)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
        reason = excluded.reason,
        status = 'Pending'
        WHERE excuses.status = 'Pending'
    `, [user_id, date, reason]);

    if (result.changes > 0) {
        res.status(201).json({ message: 'Excuse submitted or updated successfully.' });
    } else {
        // This happens if the student tries to update an already approved/denied excuse.
        res.status(403).json({ error: 'Cannot update an excuse that has already been processed.' });
    }
}));

app.get('/api/student/summary', asyncHandler(async (req, res) => {
    const { id: user_id } = req.session.user;
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'Start and end dates are required.' });
    }
    try {
        const db = await dbPromise;
        const rows = await db.all(`SELECT status, COUNT(status) as count FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY status`, [user_id, start, end]);
        const summary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
        rows.forEach(row => { if (summary.hasOwnProperty(row.status)) summary[row.status] = row.count; });
        res.json({ success: true, data: summary });
    } catch (err) {
        throw err;
    }
}));

// Audit Log (admin only)
app.get('/api/audit-logs', requireRole(['admin']), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20; // Fixed limit for logs
    const offset = (page - 1) * limit;

    const db = await dbPromise;
    const logs = await db.all(
        'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?',
        [limit, offset]
    );
    const totalResult = await db.get('SELECT COUNT(*) as count FROM audit_logs');
    const totalLogs = totalResult.count;
    const totalPages = Math.ceil(totalLogs / limit);

    res.json({ success: true, data: {
        logs,
        pagination: {
            currentPage: page,
            totalPages,
            totalLogs,
        },
    }});
}));

// --- Student Registration (Signup & Approval) ---

app.post('/api/student-signup', asyncHandler(async (req, res) => {
    const { name, username, password, age, gender, course_id, year_level } = req.body;

    if (!name || !username || !password || !age || !gender || !course_id || !year_level) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;

    // Check if username exists in users or pending registrations
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    const existingPending = await db.get('SELECT id FROM student_registrations WHERE username = ?', username);

    if (existingUser || existingPending) {
        return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(`
        INSERT INTO student_registrations (name, username, password, age, gender, course_id, year_level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, username, hashedPassword, age, gender, course_id, year_level]);

    res.status(201).json({ success: true, message: 'Registration submitted successfully. Please wait for admin approval.' });
}));

app.get('/api/student-registrations', requireRole(['admin']), asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const registrations = await db.all(`
        SELECT sr.*, c.code as course_code, c.name as course_name
        FROM student_registrations sr
        LEFT JOIN courses c ON sr.course_id = c.id
        ORDER BY sr.timestamp ASC
    `);
    res.json({ success: true, data: registrations });
}));

app.post('/api/student-registrations/:id/approve', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;

    const registration = await db.get('SELECT * FROM student_registrations WHERE id = ?', id);
    if (!registration) {
        return res.status(404).json({ error: 'Registration not found.' });
    }

    await db.run('BEGIN IMMEDIATE');
    try {
        // Double check username uniqueness
        const existingUser = await db.get('SELECT id FROM users WHERE username = ?', registration.username);
        if (existingUser) {
            await db.run('ROLLBACK');
            return res.status(409).json({ error: `Username ${registration.username} is already taken.` });
        }

        // 1. Create User
        const userResult = await db.run("INSERT INTO users (username, password, role, name) VALUES (?, ?, 'student', ?)", [registration.username, registration.password, registration.name]);
        const userId = userResult.lastID;

        // 2. Generate Student Code
        const studentCode = await generateStudentCode(db);

        // 3. Create Student Details
        await db.run("INSERT INTO student_details (user_id, student_code, age, gender, year_level) VALUES (?, ?, ?, ?, ?)", 
            [userId, studentCode, registration.age, registration.gender, registration.year_level]);

        // 4. Enroll in Course
        if (registration.course_id) {
            const course = await db.get('SELECT id FROM courses WHERE id = ?', registration.course_id);
            if (course) {
                await db.run('INSERT INTO student_courses (user_id, course_id) VALUES (?, ?)', [userId, registration.course_id]);
            }
        }

        // 5. Delete Registration
        await db.run('DELETE FROM student_registrations WHERE id = ?', id);

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'APPROVE_REGISTRATION', { registration_id: id, new_student_code: studentCode });
        res.json({ success: true, message: 'Student registration approved.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.post('/api/student-registrations/:id/reject', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    await db.run('DELETE FROM student_registrations WHERE id = ?', id);
    await logAction(req.session.user.id, req.session.user.username, 'REJECT_REGISTRATION', { registration_id: id });
    res.json({ success: true, message: 'Registration rejected.' });
}));

// --- Staff Registration (Signup & Approval) ---

app.post('/api/staff-signup', asyncHandler(async (req, res) => {
    const { name, username, password } = req.body;
    // Default role to teacher for public signup
    const role = 'teacher';

    if (!name || !username || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;

    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    const existingPending = await db.get('SELECT id FROM staff_registrations WHERE username = ?', username);

    if (existingUser || existingPending) {
        return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(`
        INSERT INTO staff_registrations (name, username, password, role)
        VALUES (?, ?, ?, ?)
    `, [name, username, hashedPassword, role]);

    res.status(201).json({ success: true, message: 'Registration submitted successfully. Please wait for admin approval.' });
}));

app.get('/api/staff-registrations', requireRole(['admin']), asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const registrations = await db.all('SELECT * FROM staff_registrations ORDER BY timestamp ASC');
    res.json({ success: true, data: registrations });
}));

app.post('/api/staff-registrations/:id/approve', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;

    const registration = await db.get('SELECT * FROM staff_registrations WHERE id = ?', id);
    if (!registration) {
        return res.status(404).json({ error: 'Registration not found.' });
    }

    await db.run('BEGIN IMMEDIATE');
    try {
        const existingUser = await db.get('SELECT id FROM users WHERE username = ?', registration.username);
        if (existingUser) {
            await db.run('ROLLBACK');
            return res.status(409).json({ error: `Username ${registration.username} is already taken.` });
        }

        await db.run("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)",
            [registration.username, registration.password, registration.role, registration.name]);

        await db.run('DELETE FROM staff_registrations WHERE id = ?', id);

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'APPROVE_STAFF_REGISTRATION', { registration_id: id, username: registration.username });
        res.json({ success: true, message: 'Staff registration approved.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.post('/api/staff-registrations/:id/reject', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    await db.run('DELETE FROM staff_registrations WHERE id = ?', id);
    await logAction(req.session.user.id, req.session.user.username, 'REJECT_STAFF_REGISTRATION', { registration_id: id });
    res.json({ success: true, message: 'Registration rejected.' });
}));

// --- Announcements ---

app.get('/api/announcements', isAuthenticated, asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const announcements = await db.all(`
        SELECT a.*, u.name as author_name 
        FROM announcements a 
        LEFT JOIN users u ON a.created_by = u.id 
        ORDER BY a.created_at DESC
    `);
    res.json({ success: true, data: announcements });
}));

app.post('/api/announcements', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });
    
    const db = await dbPromise;
    const result = await db.run(
        'INSERT INTO announcements (title, content, created_by) VALUES (?, ?, ?)',
        [title, content, req.session.user.id]
    );
    
    await logAction(req.session.user.id, req.session.user.username, 'CREATE_ANNOUNCEMENT', { id: result.lastID, title });
    res.status(201).json({ success: true, message: 'Announcement posted.' });
}));

app.delete('/api/announcements/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    await db.run('DELETE FROM announcements WHERE id = ?', id);
    await logAction(req.session.user.id, req.session.user.username, 'DELETE_ANNOUNCEMENT', { id });
    res.json({ success: true, message: 'Announcement deleted.' });
}));

// --- Generic Authenticated User Actions ---

app.post('/api/user/change-password', isAuthenticated, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { id: userId, username } = req.session.user;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT password FROM users WHERE id = ?', userId);

    // This should not happen if the user is logged in, but as a safeguard
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);

    if (!passwordMatch) {
        await logAction(userId, username, 'CHANGE_PASSWORD_FAIL', { reason: 'Incorrect current password' });
        return res.status(403).json({ error: 'Incorrect current password.' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);

    await logAction(userId, username, 'CHANGE_PASSWORD_SUCCESS');
    res.json({ success: true, message: 'Password changed successfully.' });
}));

// --- Serve Frontend ---

// Redirect root to login or dashboard
app.get('/', (req, res) => {
    if (needsSetup) {
        return res.sendFile(path.join(__dirname, 'public', 'setup.html'));
    }
    if (req.session.user) {
        // If user is logged in, redirect to their respective dashboard
        const dashboard = req.session.user.role === 'student' ? '/student-dashboard.html' : '/dashboard.html';
        res.redirect(dashboard);
    } else {
        // If not logged in, serve the login page as the default
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// Protect dashboard page
app.get('/dashboard.html', (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    if (req.session.user.role === 'student') return res.status(403).send('Access Denied');
    next();
});

app.get('/student-dashboard.html', (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'student') return res.redirect('/login.html');
    next();
});

// --- Start Server ---
async function startServer() {
    try {
        // Wait for the database connection to be established
        const db = await dbPromise;
        console.log('Database connection established.');

        // Ensure schema exists (idempotent) before running queries that rely on tables
        if (typeof dbPromise.ensureSchema === 'function') {
            await dbPromise.ensureSchema();
        }

        // Create rooms table if it doesn't exist
        await db.run(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                room_number TEXT NOT NULL
            )
        `);

        // Create courses table
        await db.run(`
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                room_id INTEGER,
                start_time TEXT,
                end_time TEXT,
                days TEXT,
                FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE SET NULL
            )
        `);

        // Migration: Add room_id column if it doesn't exist
        try {
            await db.run("ALTER TABLE courses ADD COLUMN room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL");
        } catch (err) { /* Column likely exists */ }

        // Migration: Add schedule columns if they don't exist
        try { await db.run("ALTER TABLE courses ADD COLUMN start_time TEXT"); } catch (err) {}
        try { await db.run("ALTER TABLE courses ADD COLUMN end_time TEXT"); } catch (err) {}
        try { await db.run("ALTER TABLE courses ADD COLUMN days TEXT"); } catch (err) {}

        // Create student_courses table
        await db.run(`
            CREATE TABLE IF NOT EXISTS student_courses (
                user_id INTEGER,
                course_id INTEGER,
                PRIMARY KEY (user_id, course_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
            )
        `);

        // Migrate attendance table to include course_id if it doesn't exist
        const tableInfo = await db.all("PRAGMA table_info(attendance)");
        const hasCourseId = tableInfo.some(col => col.name === 'course_id');

        if (!hasCourseId) {
            console.log('Migrating attendance table to include course_id...');
            await db.run("ALTER TABLE attendance RENAME TO attendance_old");
            await db.run(`
                CREATE TABLE attendance (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    course_id INTEGER,
                    date TEXT,
                    time TEXT,
                    status TEXT,
                    UNIQUE(user_id, course_id, date),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            `);
            // Note: Old attendance records without course_id are effectively orphaned/archived in attendance_old
            // because we can't map them to specific courses automatically.
        }

        // Create app_meta table for sequence generation if it doesn't exist
        await db.run(`
            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY,
                value INTEGER
            )
        `);

        // Create student_registrations table
        await db.run(`
            CREATE TABLE IF NOT EXISTS student_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                age INTEGER,
                gender TEXT,
                course_id INTEGER,
                year_level TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create staff_registrations table
        await db.run(`
            CREATE TABLE IF NOT EXISTS staff_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create announcements table
        await db.run(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        `);

        // Create attendance_sessions table
        await db.run(`
            CREATE TABLE IF NOT EXISTS attendance_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id INTEGER,
                date TEXT,
                code TEXT UNIQUE,
                start_time TEXT,
                end_time TEXT,
                room_id INTEGER,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE SET NULL,
                FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
                UNIQUE(course_id, date)
            )
        `);

        // Migration: Add room_id to attendance_sessions
        try { await db.run("ALTER TABLE attendance_sessions ADD COLUMN room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL"); } catch (err) {}
        try { await db.run("ALTER TABLE attendance_sessions ADD COLUMN end_time TEXT"); } catch (err) {}
        try { await db.run("ALTER TABLE attendance_sessions ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL"); } catch (err) {}

        // Migration: Remove legacy 'room' column from student_details if it exists
        try {
            const tableInfo = await db.all("PRAGMA table_info(student_details)");
            if (tableInfo.some(col => col.name === 'room')) {
                await db.run("ALTER TABLE student_details DROP COLUMN room");
            }
        } catch (err) { console.error("Migration warning: Could not drop 'room' column from student_details", err.message); }

        // Migration: Add year_level to student_details
        try { await db.run("ALTER TABLE student_details ADD COLUMN year_level TEXT"); } catch (err) {}

        // Migration: Add processed_by to excuses
        try { await db.run("ALTER TABLE excuses ADD COLUMN processed_by INTEGER REFERENCES users(id)"); } catch (err) {}

        // Check if an admin user exists
        const adminUser = await db.get("SELECT username FROM users WHERE role = 'admin'");
        if (!adminUser) {
            needsSetup = true;
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            console.log('!!! NO ADMIN USER FOUND. RUNNING IN SETUP MODE.');
            console.log('!!! Visit http://localhost:3000 to create an admin account.');
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        }

        // --- Auto-Absent Job ---
        const runAutoAbsentJob = async () => {
            try {
                const now = new Date();
                const todayStr = now.toISOString().split('T')[0];
                const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const currentDay = days[now.getDay()];
                const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

                // Get all courses
                const courses = await db.all("SELECT id, code, days, end_time FROM courses");
                
                // Get sessions for today to handle overrides or non-recurring sessions
                const sessions = await db.all("SELECT course_id, end_time FROM attendance_sessions WHERE date = ?", todayStr);
                const sessionMap = new Map(sessions.map(s => [s.course_id, s]));

                for (const course of courses) {
                    let shouldCheck = false;
                    let effectiveEndTime = course.end_time;

                    // Check if there is a specific session for today
                    if (sessionMap.has(course.id)) {
                        shouldCheck = true;
                        const session = sessionMap.get(course.id);
                        if (session.end_time) {
                            effectiveEndTime = session.end_time;
                        }
                    } else {
                        // Fallback to recurring schedule
                        if (course.days && course.end_time) {
                            const courseDays = course.days.split(',').map(d => d.trim());
                            if (courseDays.includes(currentDay)) {
                                shouldCheck = true;
                            }
                        }
                    }

                    if (!shouldCheck || !effectiveEndTime) continue;

                    // Check if class has ended
                    if (currentTime > effectiveEndTime) {
                        // Get enrolled students
                        const enrolledStudents = await db.all("SELECT user_id FROM student_courses WHERE course_id = ?", course.id);
                        
                        if (enrolledStudents.length > 0) {
                            // Find students who already have a record for today (Present, Late, Excused, or already Absent)
                            const existingRecords = await db.all("SELECT user_id FROM attendance WHERE course_id = ? AND date = ?", [course.id, todayStr]);
                            const existingUserIds = new Set(existingRecords.map(r => r.user_id));

                            const missingStudents = enrolledStudents.filter(s => !existingUserIds.has(s.user_id));

                            if (missingStudents.length > 0) {
                                console.log(`[Auto-Absent] Marking ${missingStudents.length} students absent for ${course.code} on ${todayStr}`);
                                await db.run('BEGIN IMMEDIATE');
                                try {
                                    const stmt = await db.prepare('INSERT OR IGNORE INTO attendance (user_id, course_id, date, time, status) VALUES (?, ?, ?, ?, ?)');
                                    for (const s of missingStudents) {
                                        await stmt.run(s.user_id, course.id, todayStr, '--', 'Absent');
                                    }
                                    await stmt.finalize();
                                    await db.run('COMMIT');
                                } catch (e) {
                                    console.error('[Auto-Absent] Error inserting records:', e);
                                    await db.run('ROLLBACK');
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[Auto-Absent] Job failed:', err);
            }
        };

        // Run initially and then every 15 minutes
        runAutoAbsentJob();
        setInterval(runAutoAbsentJob, 15 * 60 * 1000);

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

// Centralized error handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Handle specific SQLite constraint errors, like for unique usernames
    if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'A record with this identifier already exists.' });
    }

    res.status(500).json({
        error: 'An internal server error occurred.'
    });
});