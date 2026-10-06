import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { createEvent, listEvents } from '../services/eventsService.js';
import { createLeave, listLeave } from '../services/leaveService.js';
import { processAndSaveUpload } from '../services/uploadService.js';
import { importRulesCsv, getStoredRules } from '../services/rulesService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../../../sample-data');
async function seedChatbotInputs() {
    console.log('Seeding chatbot inputs (events and leave)...');
    // Ensure prerequisite datasets (rules, rooms, staff) are loaded if missing
    const { rules } = getStoredRules();
    if (!rules) {
        console.log('Rules not found, importing sample-data/rules.csv first...');
        const rulesBuffer = fs.readFileSync(path.join(sampleDataDir, 'rules.csv'));
        importRulesCsv(rulesBuffer);
    }
    const roomsPath = path.join(sampleDataDir, 'rooms.csv');
    if (fs.existsSync(roomsPath)) {
        const roomsBuf = fs.readFileSync(roomsPath);
        processAndSaveUpload('rooms', 'rooms.csv', roomsBuf);
    }
    const staffPath = path.join(sampleDataDir, 'staff.csv');
    if (fs.existsSync(staffPath)) {
        const staffBuf = fs.readFileSync(staffPath);
        processAndSaveUpload('staff', 'staff.csv', staffBuf);
    }
    // 1. Seed events.csv
    const eventsCsvPath = path.join(sampleDataDir, 'events.csv');
    if (fs.existsSync(eventsCsvPath)) {
        const text = fs.readFileSync(eventsCsvPath, 'utf-8');
        const parsed = Papa.parse(text, {
            header: true,
            skipEmptyLines: 'greedy',
        });
        let eventCount = 0;
        for (const row of parsed.data) {
            try {
                const staffArr = (row.staff_involved || '').split(';').map((s) => s.trim()).filter(Boolean);
                createEvent({
                    event_id: row.event_id,
                    event_name: row.event_name,
                    event_type: row.event_type,
                    date: row.date,
                    start_period: Number(row.start_period),
                    end_period: Number(row.end_period),
                    venue_room_id: row.venue_room_id,
                    staff_involved: staffArr,
                    student_scope: row.student_scope || 'ALL',
                    expected_attendance: Number(row.expected_attendance || 0),
                });
                eventCount++;
            }
            catch (err) {
                console.warn(`Event ${row.event_id} note: ${err.message}`);
            }
        }
        console.log(`Seeded ${eventCount} events. Total events now: ${listEvents().length}`);
    }
    // 2. Seed leave.csv
    const leaveCsvPath = path.join(sampleDataDir, 'leave.csv');
    if (fs.existsSync(leaveCsvPath)) {
        const text = fs.readFileSync(leaveCsvPath, 'utf-8');
        const parsed = Papa.parse(text, {
            header: true,
            skipEmptyLines: 'greedy',
        });
        let leaveCount = 0;
        for (const row of parsed.data) {
            try {
                createLeave({
                    leave_id: row.leave_id,
                    staff_id: row.staff_id,
                    date_from: row.date_from,
                    date_to: row.date_to,
                    leave_type: row.leave_type,
                    reason: row.reason || '',
                    status: row.status || 'approved',
                });
                leaveCount++;
            }
            catch (err) {
                console.warn(`Leave ${row.leave_id} note: ${err.message}`);
            }
        }
        console.log(`Seeded ${leaveCount} leaves. Total leaves now: ${listLeave().length}`);
    }
    console.log('Seeding completed successfully.');
}
seedChatbotInputs().catch((err) => {
    console.error('Seeding error:', err);
    process.exit(1);
});
