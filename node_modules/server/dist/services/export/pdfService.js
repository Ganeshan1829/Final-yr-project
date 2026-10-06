import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { getDashboardSummary, getHoursAnalysis, getChangesAnalysis } from '../dashboard/dashboardService.js';
import { ensureExportsDir } from './exportStorage.js';
/**
 * Finds available Chromium / Chrome / Edge executable on the host system.
 */
export function findChromiumPath() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const candidatePaths = [
        // Windows Edge & Chrome
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        // Linux
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/chrome',
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}
/**
 * Generates the multi-page publication-grade PDF
 */
export async function generateTimetablePdf(options = {}) {
    const chromiumPath = findChromiumPath();
    if (!chromiumPath) {
        throw new Error('Chromium or Edge/Chrome browser not found on host machine. Please install Google Chrome or Microsoft Edge to enable PDF export.');
    }
    const exportsDir = ensureExportsDir();
    const { rules } = getStoredRules();
    const semesterName = (rules?.semester_name || 'TERM').replace(/[^a-zA-Z0-9_-]/g, '_');
    const scopeTag = options.scope || 'whole_college';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `timetable_${semesterName}_${scopeTag}_${dateStr}.pdf`;
    const filePath = path.join(exportsDir, filename);
    const kpis = getDashboardSummary();
    const hoursData = getHoursAnalysis();
    const changesData = getChangesAnalysis();
    const workingDays = rules?.working_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const periodsPerDay = rules?.periods_per_day || 7;
    // Fetch Calendar Sessions
    let calQuery = `
    SELECT
      c.*,
      s.section_label,
      s.size as section_size,
      sub.subject_name,
      sub.department,
      stf.staff_name,
      r.room_name
    FROM calendar_sessions c
    JOIN sections s ON c.section_id = s.section_id
    JOIN subjects sub ON c.subject_code = sub.subject_code
    LEFT JOIN staff stf ON c.staff_id = stf.staff_id
    LEFT JOIN rooms r ON c.room_id = r.room_id
    WHERE 1=1
  `;
    const calParams = [];
    if (options.scope === 'department' && options.scope_value) {
        calQuery += ` AND sub.department = ?`;
        calParams.push(options.scope_value);
    }
    else if (options.scope === 'section' && options.scope_value) {
        calQuery += ` AND (c.section_id = ? OR s.section_label = ?)`;
        calParams.push(options.scope_value, options.scope_value);
    }
    else if (options.scope === 'staff' && options.scope_value) {
        calQuery += ` AND c.staff_id = ?`;
        calParams.push(options.scope_value);
    }
    else if (options.scope === 'room' && options.scope_value) {
        calQuery += ` AND c.room_id = ?`;
        calParams.push(options.scope_value);
    }
    calQuery += ` ORDER BY c.session_date ASC, c.period ASC`;
    const calendarSessions = db.prepare(calQuery).all(...calParams);
    // Fetch Weekly Slots
    let slotQuery = `
    SELECT
      t.*,
      s.section_label,
      sub.subject_name,
      sub.department,
      stf.staff_name,
      r.room_name
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    LEFT JOIN rooms r ON t.room_id = r.room_id
    WHERE 1=1
  `;
    const slotParams = [];
    if (options.scope === 'department' && options.scope_value) {
        slotQuery += ` AND sub.department = ?`;
        slotParams.push(options.scope_value);
    }
    else if (options.scope === 'section' && options.scope_value) {
        slotQuery += ` AND (t.section_id = ? OR s.section_label = ?)`;
        slotParams.push(options.scope_value, options.scope_value);
    }
    else if (options.scope === 'staff' && options.scope_value) {
        slotQuery += ` AND s.staff_id = ?`;
        slotParams.push(options.scope_value);
    }
    else if (options.scope === 'room' && options.scope_value) {
        slotQuery += ` AND t.room_id = ?`;
        slotParams.push(options.scope_value);
    }
    slotQuery += ` ORDER BY t.day_of_week ASC, t.period ASC`;
    const weeklySlots = db.prepare(slotQuery).all(...slotParams);
    // Group calendar sessions by month: YYYY-MM
    const monthMap = new Map();
    for (const s of calendarSessions) {
        const ym = s.session_date.slice(0, 7);
        if (!monthMap.has(ym))
            monthMap.set(ym, []);
        monthMap.get(ym).push(s);
    }
    // Filter months if requested
    const monthsToRender = Array.from(monthMap.keys()).sort();
    const selectedMonths = options.month && options.month !== 'all'
        ? monthsToRender.filter((m) => m === options.month)
        : monthsToRender;
    // Build HTML representation
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Timetable Calendar Export</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 12mm 12mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', Arial, -apple-system, BlinkMacSystemFont, sans-serif, 'Noto Sans Tamil', 'Latha';
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.3;
    }
    .page {
      page-break-after: always;
      width: 100%;
      min-height: 185mm;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .page:last-child {
      page-break-after: avoid;
    }

    /* Cover Page */
    .cover-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 180mm;
      text-align: center;
      border: 3px double #334155;
      padding: 40px;
      background: #fafafa;
    }
    .cover-title {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .cover-sub {
      font-size: 15px;
      color: #475569;
      margin-bottom: 24px;
    }
    .cover-meta {
      width: 480px;
      margin: 20px auto;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    .cover-meta td {
      padding: 8px 12px;
      border-bottom: 1px solid #cbd5e1;
    }
    .cover-meta td:first-child {
      font-weight: bold;
      color: #334155;
      width: 45%;
      background: #f1f5f9;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 11px;
    }
    .badge-clean { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .badge-stale { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

    /* Page Headers & Footers */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .page-header h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
    }
    .page-header span {
      font-size: 10px;
      color: #64748b;
    }

    /* Legend Strip */
    .legend-strip {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 8px;
      font-size: 10px;
      background: #f8fafc;
      padding: 6px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      display: inline-block;
    }
    .dot-scheduled { background: #e0f2fe; border: 1px solid #7dd3fc; }
    .dot-holiday { background: #dbeafe; border: 1px solid #93c5fd; }
    .dot-leave { background: #f3e8ff; border: 1px solid #d8b4fe; }
    .dot-event { background: #fef3c7; border: 1px solid #fde047; }
    .dot-makeup { background: #dcfce7; border: 1px solid #86efac; }
    .dot-weekend { background: #f1f5f9; border: 1px solid #cbd5e1; }

    /* Month Calendar Grid */
    .calendar-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .calendar-table th {
      background: #1e293b;
      color: #ffffff;
      padding: 6px;
      font-weight: 600;
      font-size: 10px;
      text-align: center;
      border: 1px solid #334155;
    }
    .calendar-table td {
      border: 1px solid #cbd5e1;
      height: 78px;
      vertical-align: top;
      padding: 3px;
      font-size: 8px;
      background: #ffffff;
    }
    .calendar-table td.outside-month {
      background: #f8fafc;
      opacity: 0.4;
    }
    .calendar-table td.weekend {
      background: #f8fafc;
    }
    .day-num {
      font-weight: bold;
      font-size: 10px;
      color: #1e293b;
      margin-bottom: 2px;
    }
    .session-pill {
      display: block;
      margin-bottom: 2px;
      padding: 1px 3px;
      border-radius: 2px;
      font-size: 7.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-left: 2px solid #0284c7;
      background: #f0f9ff;
    }
    .session-holiday { background: #eff6ff; border-left: 2px solid #3b82f6; color: #1e40af; font-weight: bold; }
    .session-leave { background: #faf5ff; border-left: 2px solid #a855f7; color: #6b21a8; }
    .session-event { background: #fffbeb; border-left: 2px solid #f59e0b; color: #92400e; }
    .session-makeup { background: #f0fdf4; border-left: 2px solid #22c55e; color: #166534; font-weight: bold; }

    /* Tables (Weekly, Hours, Changes) */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 9px;
    }
    .data-table th {
      background: #1e293b;
      color: #ffffff;
      padding: 6px;
      font-weight: 600;
      text-align: left;
      border: 1px solid #334155;
    }
    .data-table td {
      padding: 5px 6px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .data-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-danger { color: #dc2626; font-weight: bold; }
    .bg-danger-light { background: #fee2e2 !important; }

    /* Notices Board */
    .notice-card {
      border: 1px solid #cbd5e1;
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 10px;
      background: #f8fafc;
    }
    .notice-title {
      font-weight: bold;
      font-size: 11px;
      color: #1e293b;
      margin-bottom: 4px;
    }
    .notice-body {
      font-size: 10px;
      color: #475569;
    }
  </style>
</head>
<body>

  <!-- 1. COVER PAGE -->
  <div class="page">
    <div class="cover-container">
      <div class="cover-title">Smart Timetable System</div>
      <div class="cover-sub">Comprehensive Academic Schedule & Calendar Plan</div>

      <table class="cover-meta">
        <tr>
          <td>Semester / Term</td>
          <td>${rules?.semester_name || 'Academic Term'}</td>
        </tr>
        <tr>
          <td>Academic Year</td>
          <td>${rules?.academic_year || 'Current Academic Year'}</td>
        </tr>
        <tr>
          <td>Department / Scope</td>
          <td>${options.scope ? options.scope.toUpperCase() : 'WHOLE COLLEGE'}${options.scope_value ? ` (${options.scope_value})` : ''}</td>
        </tr>
        <tr>
          <td>Term Duration</td>
          <td>${rules?.semester_start || '—'} to ${rules?.semester_end || '—'}</td>
        </tr>
        <tr>
          <td>Weekly Periods</td>
          <td>${kpis.total_weekly_periods} periods across ${workingDays.length} working days</td>
        </tr>
        <tr>
          <td>Clash Verification</td>
          <td>
            <span class="badge ${kpis.total_clashes === 0 ? 'badge-clean' : 'badge-stale'}">
              ${kpis.total_clashes === 0 ? '0 Clashes (Verified)' : `${kpis.total_clashes} Clashes Found`}
            </span>
          </td>
        </tr>
        <tr>
          <td>Generated Timestamp</td>
          <td>${new Date().toLocaleString()}</td>
        </tr>
        <tr>
          <td>Solver Run Identifier</td>
          <td>${kpis.solver_run_id ? `#${kpis.solver_run_id}` : 'Clean Sample Run'}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- 2. MONTHLY CALENDAR PAGES -->
  ${selectedMonths
        .map((ym) => {
        const [yearStr, monthStr] = ym.split('-');
        const year = parseInt(yearStr, 10);
        const monthIndex = parseInt(monthStr, 10) - 1;
        const firstDay = new Date(year, monthIndex, 1);
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        // Monday-first offset: Mon=0, Tue=1, ... Sun=6
        const startDayOfWeek = (firstDay.getDay() + 6) % 7;
        // Group sessions by day of month
        const sessionsInMonth = monthMap.get(ym) || [];
        const daySessionsMap = new Map();
        for (const s of sessionsInMonth) {
            const d = parseInt(s.session_date.slice(8, 10), 10);
            if (!daySessionsMap.has(d))
                daySessionsMap.set(d, []);
            daySessionsMap.get(d).push(s);
        }
        // Generate calendar cells (6 rows x 7 cols = 42 cells)
        let calendarRowsHtml = '';
        let dayCounter = 1;
        let started = false;
        for (let row = 0; row < 5; row++) {
            let rowCells = '';
            for (let col = 0; col < 7; col++) {
                const cellIndex = row * 7 + col;
                if (cellIndex === startDayOfWeek) {
                    started = true;
                }
                if (started && dayCounter <= daysInMonth) {
                    const sessions = daySessionsMap.get(dayCounter) || [];
                    const isSunday = col === 6;
                    const isSaturday = col === 5;
                    const isWeekend = isSunday || (isSaturday && !rules?.saturday_makeup_allowed);
                    const pillsHtml = sessions
                        .slice(0, 3)
                        .map((s) => {
                        let cls = 'session-pill';
                        let tag = `P${s.period}: ${s.subject_code} (${s.room_id})`;
                        if (s.status === 'skipped_holiday') {
                            cls += ' session-holiday';
                            tag = `[HOLIDAY] ${s.subject_code}`;
                        }
                        else if (s.status === 'skipped_leave') {
                            cls += ' session-leave';
                            tag = `[LEAVE] ${s.subject_code}`;
                        }
                        else if (s.status === 'skipped_event') {
                            cls += ' session-event';
                            tag = `[EVENT] ${s.subject_code}`;
                        }
                        else if (s.status === 'makeup') {
                            cls += ' session-makeup';
                            tag = `[MAKEUP] P${s.period} ${s.subject_code}`;
                        }
                        return `<span class="${cls}">${tag}</span>`;
                    })
                        .join('');
                    const overflowBadge = sessions.length > 3
                        ? `<span style="font-size:7px; color:#64748b; font-weight:bold;">+${sessions.length - 3} more</span>`
                        : '';
                    rowCells += `
              <td class="${isWeekend ? 'weekend' : ''}">
                <div class="day-num">${dayCounter}</div>
                ${pillsHtml}
                ${overflowBadge}
              </td>
            `;
                    dayCounter++;
                }
                else {
                    rowCells += `<td class="outside-month"></td>`;
                }
            }
            calendarRowsHtml += `<tr>${rowCells}</tr>`;
            if (dayCounter > daysInMonth && row >= 4)
                break;
        }
        return `
        <div class="page">
          <div class="page-header">
            <h2>Academic Calendar — ${monthName}</h2>
            <span>Scope: ${options.scope ? options.scope.toUpperCase() : 'WHOLE COLLEGE'}</span>
          </div>

          <div class="legend-strip">
            <span class="legend-item"><span class="dot dot-scheduled"></span> Regular Class</span>
            <span class="legend-item"><span class="dot dot-holiday"></span> Holiday</span>
            <span class="legend-item"><span class="dot dot-leave"></span> Staff Leave</span>
            <span class="legend-item"><span class="dot dot-event"></span> Campus Event</span>
            <span class="legend-item"><span class="dot dot-makeup"></span> Make-up Class</span>
            <span class="legend-item"><span class="dot dot-weekend"></span> Non-working / Weekend</span>
          </div>

          <table class="calendar-table">
            <thead>
              <tr>
                <th>Monday</th>
                <th>Tuesday</th>
                <th>Wednesday</th>
                <th>Thursday</th>
                <th>Friday</th>
                <th>Saturday</th>
                <th>Sunday</th>
              </tr>
            </thead>
            <tbody>
              ${calendarRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    })
        .join('')}

  <!-- 3. RECURRING WEEKLY MASTER TIMETABLE -->
  <div class="page">
    <div class="page-header">
      <h2>Recurring Weekly Master Schedule</h2>
      <span>Term: ${rules?.semester_name || 'Academic Term'} | Total Slots: ${weeklySlots.length}</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 10%;">Day</th>
          <th style="width: 8%;">Period</th>
          <th style="width: 14%;">Section</th>
          <th style="width: 26%;">Course / Subject</th>
          <th style="width: 22%;">Faculty</th>
          <th style="width: 12%;">Room</th>
          <th style="width: 8%;">Type</th>
        </tr>
      </thead>
      <tbody>
        ${weeklySlots.length === 0
        ? `<tr><td colspan="7" class="text-center" style="padding: 20px;">No weekly slots scheduled for this scope.</td></tr>`
        : weeklySlots
            .slice(0, 32) // Keep compact to fit on single landscape page cleanly
            .map((slot, idx) => {
            const dayName = workingDays[slot.day_of_week - 1] || `Day ${slot.day_of_week}`;
            return `
                    <tr>
                      <td class="text-center font-bold">${dayName}</td>
                      <td class="text-center">Period ${slot.period}</td>
                      <td>${slot.section_label || `SEC-${slot.section_id}`}</td>
                      <td>${slot.subject_code} - ${slot.subject_name || ''}</td>
                      <td>${slot.staff_name || slot.staff_id}</td>
                      <td class="text-center">${slot.room_id}</td>
                      <td class="text-center">${slot.is_lab_block ? '<b>LAB</b>' : 'Theory'}</td>
                    </tr>
                  `;
        })
            .join('')}
      </tbody>
    </table>
    ${weeklySlots.length > 32
        ? `<div style="margin-top: 6px; font-size: 9px; color: #64748b; text-align: right;">(Showing top 32 slots; download Excel workbook for complete unfiltered master grid)</div>`
        : ''}
  </div>

  <!-- 4. CHANGE NOTICES PAGE -->
  <div class="page">
    <div class="page-header">
      <h2>Notice Board — Management Modifications & Re-solves</h2>
      <span>Applied Changes Log</span>
    </div>

    ${changesData.recent_log.length === 0
        ? `<div class="notice-card" style="border-left-color: #10b981; padding: 24px; text-align: center;">
             <div class="notice-title" style="color: #059669; font-size: 13px;">No changes this period.</div>
             <div class="notice-body">All classes follow the published regular baseline timetable with zero manual adjustments.</div>
           </div>`
        : changesData.recent_log
            .map((chg) => `
              <div class="notice-card">
                <div class="notice-title">
                  [${chg.type.toUpperCase()}] ${chg.summary}
                </div>
                <div class="notice-body">
                  <b>Applied:</b> ${chg.created_at} &nbsp;|&nbsp;
                  <b>Authorized By:</b> ${chg.created_by} &nbsp;|&nbsp;
                  <b>Status:</b> ${chg.status.toUpperCase()}
                </div>
              </div>
            `)
            .join('')}
  </div>

  <!-- 5. HOURS SUMMARY PAGE -->
  <div class="page">
    <div class="page-header">
      <h2>Hours Summary & Syllabus Delivery Audit</h2>
      <span>Required vs Delivered Hours</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Course Code</th>
          <th>Course Name</th>
          <th>Department</th>
          <th>Faculty</th>
          <th class="text-right">Required (Hrs)</th>
          <th class="text-right">Delivered (Hrs)</th>
          <th class="text-right">Shortfall (Hrs)</th>
          <th class="text-right">Makeup Approved</th>
          <th class="text-right">Final Shortfall</th>
          <th class="text-center">Delivery %</th>
        </tr>
      </thead>
      <tbody>
        ${hoursData.subjects
        .slice(0, 24)
        .map((item) => {
        const hasShortfall = item.final_shortfall > 0;
        return `
              <tr class="${hasShortfall ? 'bg-danger-light' : ''}">
                <td class="font-bold">${item.subject_code}</td>
                <td>${item.subject_name}</td>
                <td>${item.department}</td>
                <td>${item.staff_name}</td>
                <td class="text-right">${item.required_hours}</td>
                <td class="text-right">${item.delivered_hours}</td>
                <td class="text-right ${item.shortfall_hours > 0 ? 'text-danger' : ''}">${item.shortfall_hours}</td>
                <td class="text-right">${item.makeup_approved_hours}</td>
                <td class="text-right ${hasShortfall ? 'text-danger' : ''}">${item.final_shortfall}</td>
                <td class="text-center font-bold">${item.progress_pct}%</td>
              </tr>
            `;
    })
        .join('')}
      </tbody>
      <tfoot>
        <tr style="background: #e2e8f0; font-weight: bold;">
          <td colspan="4" class="text-center">TOTALS</td>
          <td class="text-right">${hoursData.totals.required_hours}</td>
          <td class="text-right">${hoursData.totals.delivered_hours}</td>
          <td class="text-right ${hoursData.totals.shortfall_hours > 0 ? 'text-danger' : ''}">${hoursData.totals.shortfall_hours}</td>
          <td class="text-right">${hoursData.totals.makeup_approved_hours}</td>
          <td class="text-right ${hoursData.totals.final_shortfall_hours > 0 ? 'text-danger' : ''}">${hoursData.totals.final_shortfall_hours}</td>
          <td class="text-center">${hoursData.totals.overall_completion_pct}%</td>
        </tr>
      </tfoot>
    </table>
  </div>

</body>
</html>
  `;
    // Launch headless browser with puppeteer-core
    const browser = await puppeteer.launch({
        executablePath: chromiumPath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdfUint8Array = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: {
                top: '12mm',
                bottom: '12mm',
                left: '12mm',
                right: '12mm',
            },
            displayHeaderFooter: true,
            headerTemplate: `<div style="font-size:8px; color:#94a3b8; width:100%; text-align:center; padding-top:4px;">Smart Timetable System — ${rules?.semester_name || 'Academic Term'}</div>`,
            footerTemplate: `<div style="font-size:8px; color:#94a3b8; width:100%; display:flex; justify-content:space-between; padding:0 12mm 4px 12mm;">
        <span>Generated: ${new Date().toLocaleDateString()}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
        });
        const pdfBuffer = Buffer.from(pdfUint8Array);
        fs.writeFileSync(filePath, pdfBuffer);
        return {
            filename,
            filePath,
            buffer: pdfBuffer,
            fileSize: pdfBuffer.length,
        };
    }
    finally {
        await browser.close();
    }
}
