import ExcelJS from 'exceljs';
import path from 'node:path';
import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { getDashboardSummary, getRoomUse, getClashesAnalysis } from '../dashboard/dashboardService.js';
import { ensureExportsDir } from './exportStorage.js';

const PRIMARY_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' }, // Dark slate
};

const SECONDARY_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF334155' }, // Slate 700
};

const ZEBRA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

const SHORTFALL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFE4E6' }, // Rose 100
};

const BORDER_THIN: ExcelJS.Border = {
  style: 'thin',
  color: { argb: 'FFCBD5E1' },
};

const BORDERS_ALL: Partial<ExcelJS.Borders> = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
};

function formatHeaderCell(cell: ExcelJS.Cell, text: string, fill: ExcelJS.Fill = PRIMARY_HEADER_FILL) {
  cell.value = text;
  cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = fill;
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = BORDERS_ALL;
}

function formatDataCell(
  cell: ExcelJS.Cell,
  val: any,
  align: 'left' | 'center' | 'right' = 'left',
  bg?: string,
  isBold = false
) {
  cell.value = val;
  cell.font = { name: 'Segoe UI', size: 9, bold: isBold, color: { argb: 'FF0F172A' } };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true };
  cell.border = BORDERS_ALL;
  if (bg) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bg },
    };
  }
}

/**
 * Generates the complete 8-sheet Excel workbook
 */
export async function generateTimetableExcel(): Promise<{
  filename: string;
  filePath: string;
  buffer: Buffer;
  fileSize: number;
}> {
  const exportsDir = ensureExportsDir();
  const { rules } = getStoredRules();
  const workingDays = rules?.working_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  const periodsPerDay = rules?.periods_per_day || 7;
  const semesterName = (rules?.semester_name || 'TERM').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `timetable_${semesterName}_${dateStr}.xlsx`;
  const filePath = path.join(exportsDir, filename);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Smart Timetable System';
  workbook.created = new Date();

  // Load database entities
  const slotsRaw = db.prepare(`
    SELECT
      t.*,
      s.section_label,
      s.size as section_size,
      sub.subject_name,
      sub.department,
      stf.staff_name,
      r.room_name
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    JOIN rooms r ON t.room_id = r.room_id
    ORDER BY t.day_of_week ASC, t.period ASC
  `).all() as any[];

  const sectionsRaw = db.prepare(`
    SELECT
      s.*,
      sub.subject_name,
      sub.department,
      (sub.subject_type = 'lab') AS is_lab,
      stf.staff_name,
      r.room_name
    FROM sections s
    JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    LEFT JOIN rooms r ON s.room_id = r.room_id
    ORDER BY s.section_id ASC
  `).all() as any[];

  const staffRaw = db.prepare(`SELECT * FROM staff ORDER BY staff_name ASC`).all() as any[];
  const roomsRaw = db.prepare(`SELECT * FROM rooms WHERE status = 'active' ORDER BY room_type ASC, room_id ASC`).all() as any[];

  const hoursRaw = db.prepare(`
    SELECT
      h.*,
      s.section_label,
      sub.department
    FROM hours_summary h
    JOIN sections s ON h.section_id = s.section_id
    JOIN subjects sub ON h.subject_code = sub.subject_code
    ORDER BY h.shortfall_hours DESC, h.subject_code ASC
  `).all() as any[];

  const calendarRaw = db.prepare(`
    SELECT
      c.*,
      s.section_label,
      sub.subject_name,
      stf.staff_name,
      r.room_name
    FROM calendar_sessions c
    JOIN sections s ON c.section_id = s.section_id
    JOIN subjects sub ON c.subject_code = sub.subject_code
    LEFT JOIN staff stf ON c.staff_id = stf.staff_id
    LEFT JOIN rooms r ON c.room_id = r.room_id
    ORDER BY c.session_date ASC, c.period ASC
  `).all() as any[];

  // ----------------------------------------------------
  // SHEET 1: Master Timetable
  // ----------------------------------------------------
  const wsMaster = workbook.addWorksheet('Master Timetable', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, fitToPage: true },
  });

  // Title Row
  wsMaster.mergeCells('A1:Z1');
  const titleCell = wsMaster.getCell('A1');
  titleCell.value = `MASTER TIMETABLE — ${rules?.semester_name || 'Academic Term'} (${rules?.academic_year || ''})`;
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FF1E293B' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  wsMaster.getRow(1).height = 28;

  // Header columns: Section | Subject | Faculty | Room | Day 1 P1..Pn | Day 2 P1..Pn ...
  const masterHeaders: string[] = ['Section', 'Subject', 'Faculty', 'Default Room'];
  const dayColIndices: { day: number; period: number; colIdx: number }[] = [];
  let colCounter = 5;

  for (let d = 0; d < workingDays.length; d++) {
    const dayName = workingDays[d];
    for (let p = 1; p <= periodsPerDay; p++) {
      masterHeaders.push(`${dayName} P${p}`);
      dayColIndices.push({ day: d + 1, period: p, colIdx: colCounter });
      colCounter++;
    }
  }

  const hRow = wsMaster.addRow(masterHeaders);
  hRow.height = 24;
  for (let c = 1; c <= masterHeaders.length; c++) {
    formatHeaderCell(hRow.getCell(c), masterHeaders[c - 1]);
  }

  wsMaster.getColumn(1).width = 16;
  wsMaster.getColumn(2).width = 24;
  wsMaster.getColumn(3).width = 20;
  wsMaster.getColumn(4).width = 16;
  for (let c = 5; c <= masterHeaders.length; c++) {
    wsMaster.getColumn(c).width = 18;
  }

  // Populate row per section
  const sectionSlotsMap = new Map<number, Map<string, any>>();
  for (const s of slotsRaw) {
    if (!sectionSlotsMap.has(s.section_id)) {
      sectionSlotsMap.set(s.section_id, new Map());
    }
    sectionSlotsMap.get(s.section_id)!.set(`${s.day_of_week}_${s.period}`, s);
  }

  let rowIdx = 3;
  for (const sec of sectionsRaw) {
    const rowValues = [
      sec.section_label || `SEC-${sec.section_id}`,
      `${sec.subject_code} - ${sec.subject_name}`,
      sec.staff_name || sec.staff_id,
      sec.room_name || sec.room_id || 'TBD',
    ];

    const slotMap = sectionSlotsMap.get(sec.section_id);
    for (const d of dayColIndices) {
      const slot = slotMap?.get(`${d.day}_${d.period}`);
      if (slot) {
        rowValues.push(`${slot.subject_code}\n${slot.room_id} (${slot.staff_id})`);
      } else {
        rowValues.push('');
      }
    }

    const dRow = wsMaster.addRow(rowValues);
    dRow.height = 32;

    for (let c = 1; c <= 4; c++) {
      formatDataCell(dRow.getCell(c), rowValues[c - 1], c === 1 ? 'center' : 'left', rowIdx % 2 === 0 ? 'FFF8FAFC' : undefined, c === 1);
    }

    // Merge lab blocks across consecutive periods
    for (let d = 1; d <= workingDays.length; d++) {
      let p = 1;
      while (p <= periodsPerDay) {
        const slot = slotMap?.get(`${d}_${p}`);
        if (slot && slot.is_lab_block) {
          // Check how many consecutive periods share this lab block
          let span = 1;
          while (p + span <= periodsPerDay) {
            const nextSlot = slotMap?.get(`${d}_${p + span}`);
            if (nextSlot && nextSlot.is_lab_block && nextSlot.room_id === slot.room_id) {
              span++;
            } else {
              break;
            }
          }

          const startCol = 4 + (d - 1) * periodsPerDay + p;
          const endCol = startCol + span - 1;

          for (let sc = startCol; sc <= endCol; sc++) {
            formatDataCell(dRow.getCell(sc), dRow.getCell(sc).value, 'center', 'FFE0E7FF', true);
          }

          if (span > 1) {
            try {
              wsMaster.mergeCells(rowIdx, startCol, rowIdx, endCol);
              const mergedCell = wsMaster.getCell(rowIdx, startCol);
              mergedCell.value = `[LAB BLOCK]\n${slot.subject_code}\n${slot.room_id}`;
              mergedCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } catch {}
          }
          p += span;
        } else {
          const col = 4 + (d - 1) * periodsPerDay + p;
          formatDataCell(dRow.getCell(col), dRow.getCell(col).value, 'center', slot ? (rowIdx % 2 === 0 ? 'FFF8FAFC' : undefined) : undefined);
          p++;
        }
      }
    }

    rowIdx++;
  }

  // ----------------------------------------------------
  // SHEET 2: Staff-wise Timetable
  // ----------------------------------------------------
  const wsStaff = workbook.addWorksheet('Staff-wise', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, fitToPage: true },
  });

  const staffSlotsMap = new Map<string, any[]>();
  for (const s of slotsRaw) {
    if (!staffSlotsMap.has(s.staff_id)) staffSlotsMap.set(s.staff_id, []);
    staffSlotsMap.get(s.staff_id)!.push(s);
  }

  let sRowIdx = 1;
  for (const stf of staffRaw) {
    const stfSlots = staffSlotsMap.get(stf.staff_id) || [];
    const totalWeeklyHours = stfSlots.length;

    // Faculty Header Block
    wsStaff.mergeCells(`A${sRowIdx}:H${sRowIdx}`);
    const banner = wsStaff.getCell(`A${sRowIdx}`);
    banner.value = `Faculty: ${stf.staff_name} (${stf.staff_id}) — Dept: ${stf.department || 'N/A'} | Scheduled: ${totalWeeklyHours} hrs/wk (Limit: ${stf.max_hours_per_week || 20})`;
    banner.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    banner.fill = SECONDARY_HEADER_FILL;
    banner.alignment = { vertical: 'middle', horizontal: 'left' };
    wsStaff.getRow(sRowIdx).height = 24;
    sRowIdx++;

    // Grid headers
    const staffHeaders = ['Day', ...Array.from({ length: periodsPerDay }, (_, i) => `Period ${i + 1}`)];
    const hR = wsStaff.addRow(staffHeaders);
    hR.height = 20;
    for (let c = 1; c <= staffHeaders.length; c++) {
      formatHeaderCell(hR.getCell(c), staffHeaders[c - 1]);
    }
    sRowIdx++;

    // Day rows
    for (let d = 0; d < workingDays.length; d++) {
      const daySlots = stfSlots.filter((s) => s.day_of_week === d + 1);
      const rowVals = [workingDays[d]];

      for (let p = 1; p <= periodsPerDay; p++) {
        const slot = daySlots.find((s) => s.period === p);
        if (slot) {
          rowVals.push(`${slot.subject_code} (${slot.section_label || slot.section_id})\nRoom: ${slot.room_id}`);
        } else {
          rowVals.push('—');
        }
      }

      const dR = wsStaff.addRow(rowVals);
      dR.height = 28;
      formatDataCell(dR.getCell(1), rowVals[0], 'center', undefined, true);
      for (let c = 2; c <= staffHeaders.length; c++) {
        formatDataCell(dR.getCell(c), rowVals[c - 1], 'center', rowVals[c - 1] !== '—' ? 'FFF0FDF4' : undefined);
      }
      sRowIdx++;
    }

    sRowIdx++; // spacer row
  }

  wsStaff.getColumn(1).width = 14;
  for (let c = 2; c <= periodsPerDay + 1; c++) {
    wsStaff.getColumn(c).width = 20;
  }

  // ----------------------------------------------------
  // SHEET 3: Room-wise Timetable
  // ----------------------------------------------------
  const wsRoom = workbook.addWorksheet('Room-wise', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, fitToPage: true },
  });

  const roomSlotsMap = new Map<string, any[]>();
  for (const s of slotsRaw) {
    if (!roomSlotsMap.has(s.room_id)) roomSlotsMap.set(s.room_id, []);
    roomSlotsMap.get(s.room_id)!.push(s);
  }

  let rRowIdx = 1;
  const totalAvailPeriods = workingDays.length * periodsPerDay;

  for (const rm of roomsRaw) {
    const rmSlots = roomSlotsMap.get(rm.room_id) || [];
    const utilPct = totalAvailPeriods > 0 ? Math.round((rmSlots.length / totalAvailPeriods) * 1000) / 10 : 0;

    wsRoom.mergeCells(`A${rRowIdx}:H${rRowIdx}`);
    const banner = wsRoom.getCell(`A${rRowIdx}`);
    banner.value = `Room: ${rm.room_name} (${rm.room_id}) — Type: ${rm.room_type.toUpperCase()} | Capacity: ${rm.capacity} | Utilization: ${utilPct}% (${rmSlots.length}/${totalAvailPeriods} periods)`;
    banner.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    banner.fill = PRIMARY_HEADER_FILL;
    banner.alignment = { vertical: 'middle', horizontal: 'left' };
    wsRoom.getRow(rRowIdx).height = 24;
    rRowIdx++;

    const roomHeaders = ['Day', ...Array.from({ length: periodsPerDay }, (_, i) => `Period ${i + 1}`)];
    const hR = wsRoom.addRow(roomHeaders);
    hR.height = 20;
    for (let c = 1; c <= roomHeaders.length; c++) {
      formatHeaderCell(hR.getCell(c), roomHeaders[c - 1]);
    }
    rRowIdx++;

    for (let d = 0; d < workingDays.length; d++) {
      const daySlots = rmSlots.filter((s) => s.day_of_week === d + 1);
      const rowVals = [workingDays[d]];

      for (let p = 1; p <= periodsPerDay; p++) {
        const slot = daySlots.find((s) => s.period === p);
        if (slot) {
          rowVals.push(`${slot.subject_code} (${slot.section_label})\nStaff: ${slot.staff_id}`);
        } else {
          rowVals.push('Available');
        }
      }

      const dR = wsRoom.addRow(rowVals);
      dR.height = 28;
      formatDataCell(dR.getCell(1), rowVals[0], 'center', undefined, true);
      for (let c = 2; c <= roomHeaders.length; c++) {
        const isFree = rowVals[c - 1] === 'Available';
        formatDataCell(dR.getCell(c), rowVals[c - 1], 'center', isFree ? undefined : 'FFFEF3C7');
      }
      rRowIdx++;
    }

    rRowIdx++; // spacer
  }

  wsRoom.getColumn(1).width = 14;
  for (let c = 2; c <= periodsPerDay + 1; c++) {
    wsRoom.getColumn(c).width = 20;
  }

  // ----------------------------------------------------
  // SHEET 4: Section-wise Timetable
  // ----------------------------------------------------
  const wsSec = workbook.addWorksheet('Section-wise', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, fitToPage: true },
  });

  let secRowIdx = 1;
  for (const sec of sectionsRaw) {
    const secSlots = slotsRaw.filter((s) => s.section_id === sec.section_id);

    wsSec.mergeCells(`A${secRowIdx}:H${secRowIdx}`);
    const banner = wsSec.getCell(`A${secRowIdx}`);
    banner.value = `Section: ${sec.section_label || `SEC-${sec.section_id}`} — ${sec.subject_code} (${sec.subject_name}) | Students: ${sec.size} | Faculty: ${sec.staff_name || sec.staff_id} | Room: ${sec.room_id || 'TBD'}`;
    banner.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    banner.fill = SECONDARY_HEADER_FILL;
    banner.alignment = { vertical: 'middle', horizontal: 'left' };
    wsSec.getRow(secRowIdx).height = 24;
    secRowIdx++;

    const secHeaders = ['Day', ...Array.from({ length: periodsPerDay }, (_, i) => `Period ${i + 1}`)];
    const hR = wsSec.addRow(secHeaders);
    hR.height = 20;
    for (let c = 1; c <= secHeaders.length; c++) {
      formatHeaderCell(hR.getCell(c), secHeaders[c - 1]);
    }
    secRowIdx++;

    for (let d = 0; d < workingDays.length; d++) {
      const daySlots = secSlots.filter((s) => s.day_of_week === d + 1);
      const rowVals = [workingDays[d]];

      for (let p = 1; p <= periodsPerDay; p++) {
        const slot = daySlots.find((s) => s.period === p);
        if (slot) {
          rowVals.push(`${slot.subject_code}\nRoom: ${slot.room_id} (${slot.staff_id})`);
        } else {
          rowVals.push('—');
        }
      }

      const dR = wsSec.addRow(rowVals);
      dR.height = 28;
      formatDataCell(dR.getCell(1), rowVals[0], 'center', undefined, true);
      for (let c = 2; c <= secHeaders.length; c++) {
        formatDataCell(dR.getCell(c), rowVals[c - 1], 'center', rowVals[c - 1] !== '—' ? 'FFF0F9FF' : undefined);
      }
      secRowIdx++;
    }

    secRowIdx++;
  }

  wsSec.getColumn(1).width = 14;
  for (let c = 2; c <= periodsPerDay + 1; c++) {
    wsSec.getColumn(c).width = 20;
  }

  // ----------------------------------------------------
  // SHEET 5: Change Log
  // ----------------------------------------------------
  const wsLog = workbook.addWorksheet('Change Log', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  const logHeaders = [
    'Change ID',
    'Type',
    'Date Applied',
    'Who',
    'Description',
    'Sessions Affected',
    'Before State',
    'After State',
    'Status',
  ];
  const hLog = wsLog.addRow(logHeaders);
  hLog.height = 24;
  for (let c = 1; c <= logHeaders.length; c++) {
    formatHeaderCell(hLog.getCell(c), logHeaders[c - 1]);
  }

  wsLog.getColumn(1).width = 14;
  wsLog.getColumn(2).width = 14;
  wsLog.getColumn(3).width = 20;
  wsLog.getColumn(4).width = 16;
  wsLog.getColumn(5).width = 34;
  wsLog.getColumn(6).width = 18;
  wsLog.getColumn(7).width = 28;
  wsLog.getColumn(8).width = 28;
  wsLog.getColumn(9).width = 14;

  let changeRows: any[] = [];
  try {
    changeRows = db.prepare(`
      SELECT
        c.id,
        c.type,
        c.applied_at,
        c.created_by,
        c.impact_summary,
        c.status,
        m.before_state,
        m.after_state
      FROM changes c
      LEFT JOIN management_change_log m ON c.id = m.change_id
      WHERE c.status = 'applied'
      ORDER BY c.id DESC
    `).all() as any[];
  } catch {}

  if (changeRows.length === 0) {
    // Show single row "No changes applied"
    const emptyRow = wsLog.addRow(['No changes applied', '—', '—', '—', 'No management modifications committed to live timetable', 0, '—', '—', 'clean']);
    emptyRow.height = 22;
    for (let c = 1; c <= logHeaders.length; c++) {
      formatDataCell(emptyRow.getCell(c), emptyRow.getCell(c).value, 'center');
    }
  } else {
    for (let i = 0; i < changeRows.length; i++) {
      const cr = changeRows[i];
      let desc = 'Management update';
      let affected = 0;
      try {
        const impact = JSON.parse(cr.impact_summary || '{}');
        desc = impact.summary || desc;
        affected = impact.affected_sessions_count || 0;
      } catch {}

      const dR = wsLog.addRow([
        cr.id,
        cr.type.toUpperCase(),
        cr.applied_at || '—',
        cr.created_by || 'HOD',
        desc,
        affected,
        cr.before_state ? cr.before_state.slice(0, 100) : '—',
        cr.after_state ? cr.after_state.slice(0, 100) : '—',
        cr.status,
      ]);
      dR.height = 22;
      for (let c = 1; c <= logHeaders.length; c++) {
        formatDataCell(dR.getCell(c), dR.getCell(c).value, c === 5 ? 'left' : 'center', i % 2 === 1 ? 'FFF8FAFC' : undefined);
      }
    }
  }

  // ----------------------------------------------------
  // SHEET 6: Hours Summary
  // ----------------------------------------------------
  const wsHours = workbook.addWorksheet('Hours Summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  const hoursHeaders = [
    'Section ID',
    'Section Label',
    'Subject Code',
    'Subject Name',
    'Department',
    'Faculty',
    'Required Hours',
    'Delivered Hours',
    'Shortfall Hours',
    'Make-up Approved',
    'Final Shortfall',
  ];
  const hHours = wsHours.addRow(hoursHeaders);
  hHours.height = 24;
  for (let c = 1; c <= hoursHeaders.length; c++) {
    formatHeaderCell(hHours.getCell(c), hoursHeaders[c - 1]);
  }

  wsHours.getColumn(1).width = 12;
  wsHours.getColumn(2).width = 16;
  wsHours.getColumn(3).width = 14;
  wsHours.getColumn(4).width = 28;
  wsHours.getColumn(5).width = 18;
  wsHours.getColumn(6).width = 22;
  wsHours.getColumn(7).width = 16;
  wsHours.getColumn(8).width = 16;
  wsHours.getColumn(9).width = 16;
  wsHours.getColumn(10).width = 18;
  wsHours.getColumn(11).width = 16;

  let startRow = 2;
  for (let i = 0; i < hoursRaw.length; i++) {
    const hr = hoursRaw[i];
    const finalShort = Math.max(0, hr.shortfall_hours - (hr.makeup_approved_hours || 0));
    const hasShortfall = finalShort > 0;

    const dR = wsHours.addRow([
      hr.section_id,
      hr.section_label || `SEC-${hr.section_id}`,
      hr.subject_code,
      hr.subject_name,
      hr.department || 'General',
      hr.staff_name || hr.staff_id,
      hr.required_hours,
      hr.delivered_hours,
      hr.shortfall_hours,
      hr.makeup_approved_hours || 0,
      finalShort,
    ]);
    dR.height = 22;

    for (let c = 1; c <= hoursHeaders.length; c++) {
      const isNum = c >= 7;
      const isShortfallCol = c === 9 || c === 11;
      const cellBg = isShortfallCol && hasShortfall ? 'FFFFE4E6' : i % 2 === 1 ? 'FFF8FAFC' : undefined;
      formatDataCell(dR.getCell(c), dR.getCell(c).value, isNum ? 'right' : c <= 3 ? 'center' : 'left', cellBg, isShortfallCol && hasShortfall);
    }
  }

  const endRow = startRow + hoursRaw.length - 1;
  // Totals Row with Formulas
  if (hoursRaw.length > 0) {
    const totRow = wsHours.addRow([
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      { formula: `SUM(G${startRow}:G${endRow})` },
      { formula: `SUM(H${startRow}:H${endRow})` },
      { formula: `SUM(I${startRow}:I${endRow})` },
      { formula: `SUM(J${startRow}:J${endRow})` },
      { formula: `SUM(K${startRow}:K${endRow})` },
    ]);
    totRow.height = 26;
    for (let c = 1; c <= hoursHeaders.length; c++) {
      formatDataCell(totRow.getCell(c), totRow.getCell(c).value, c >= 7 ? 'right' : 'center', 'FFE2E8F0', true);
    }
  }

  // ----------------------------------------------------
  // SHEET 7: Calendar (sessions list)
  // ----------------------------------------------------
  const wsCal = workbook.addWorksheet('Calendar', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  const calHeaders = [
    'Session ID',
    'Date',
    'Day',
    'Period',
    'Subject Code',
    'Subject Name',
    'Section',
    'Faculty',
    'Room',
    'Status',
    'Notes',
  ];
  const hCal = wsCal.addRow(calHeaders);
  hCal.height = 24;
  for (let c = 1; c <= calHeaders.length; c++) {
    formatHeaderCell(hCal.getCell(c), calHeaders[c - 1]);
  }

  wsCal.getColumn(1).width = 12;
  wsCal.getColumn(2).width = 14;
  wsCal.getColumn(3).width = 10;
  wsCal.getColumn(4).width = 10;
  wsCal.getColumn(5).width = 14;
  wsCal.getColumn(6).width = 24;
  wsCal.getColumn(7).width = 14;
  wsCal.getColumn(8).width = 20;
  wsCal.getColumn(9).width = 14;
  wsCal.getColumn(10).width = 18;
  wsCal.getColumn(11).width = 24;

  for (let i = 0; i < calendarRaw.length; i++) {
    const cs = calendarRaw[i];
    const statusBg =
      cs.status === 'makeup'
        ? 'FFF0FDF4'
        : cs.status === 'skipped_holiday'
        ? 'FFEFF6FF'
        : cs.status === 'skipped_leave'
        ? 'FFFAF5FF'
        : cs.status === 'skipped_event'
        ? 'FFFFFBEB'
        : undefined;

    const dR = wsCal.addRow([
      cs.session_id,
      cs.session_date,
      cs.day_of_week,
      cs.period,
      cs.subject_code,
      cs.subject_name,
      cs.section_label || `SEC-${cs.section_id}`,
      cs.staff_name || cs.staff_id,
      cs.room_name || cs.room_id,
      cs.status,
      cs.notes || '',
    ]);
    dR.height = 20;

    for (let c = 1; c <= calHeaders.length; c++) {
      formatDataCell(dR.getCell(c), dR.getCell(c).value, c === 6 || c === 11 ? 'left' : 'center', statusBg);
    }
  }

  // ----------------------------------------------------
  // SHEET 8: Summary
  // ----------------------------------------------------
  const wsSum = workbook.addWorksheet('Summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  const kpis = getDashboardSummary();
  const roomData = getRoomUse();
  const clashes = getClashesAnalysis();

  wsSum.mergeCells('A1:D1');
  const sumTitle = wsSum.getCell('A1');
  sumTitle.value = `TIMETABLE AUDIT & PERFORMANCE SUMMARY`;
  sumTitle.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FF1E293B' } };
  sumTitle.alignment = { vertical: 'middle', horizontal: 'left' };
  wsSum.getRow(1).height = 28;

  const summaryMetadata = [
    ['Semester', rules?.semester_name || 'Academic Term'],
    ['Academic Year', rules?.academic_year || 'Current'],
    ['Start Date', rules?.semester_start || '—'],
    ['End Date', rules?.semester_end || '—'],
    ['Total Working Days', workingDays.join(', ')],
    ['Periods Per Day', periodsPerDay],
    ['Solver Run ID', kpis.solver_run_id ? `#${kpis.solver_run_id}` : 'N/A'],
    ['Last Generated', kpis.last_solver_run_time || '—'],
    ['Timetable Status', kpis.timetable_status.toUpperCase()],
    ['Data Freshness', kpis.is_stale ? 'STALE' : 'CLEAN / CURRENT'],
  ];

  let sumRowIdx = 3;
  wsSum.mergeCells(`A${sumRowIdx}:B${sumRowIdx}`);
  formatHeaderCell(wsSum.getCell(`A${sumRowIdx}`), 'System & Academic Configuration');
  sumRowIdx++;

  for (const [k, v] of summaryMetadata) {
    const r = wsSum.addRow([k, v]);
    r.height = 20;
    formatDataCell(r.getCell(1), k, 'left', 'FFF8FAFC', true);
    formatDataCell(r.getCell(2), v, 'left');
    sumRowIdx++;
  }

  sumRowIdx++; // spacer

  // KPI Table
  wsSum.mergeCells(`A${sumRowIdx}:B${sumRowIdx}`);
  formatHeaderCell(wsSum.getCell(`A${sumRowIdx}`), 'Key Performance Indicators (KPIs)');
  sumRowIdx++;

  const kpiRows = [
    ['Total Sections', kpis.total_sections],
    ['Total Weekly Periods Scheduled', kpis.total_weekly_periods],
    ['Total Clashes (Hard Constraints)', kpis.total_clashes],
    ['Total Hours Shortfall', kpis.total_hours_shortfall],
    ['Changes Applied', kpis.changes_applied_count],
    ['Theory Room Avg Utilization', `${roomData.utilization_by_type.theory_avg_pct}%`],
    ['Lab Room Avg Utilization', `${roomData.utilization_by_type.lab_avg_pct}%`],
    ['Overall Room Utilization', `${roomData.utilization_by_type.overall_avg_pct}%`],
    ['Total Seat-Periods Wasted', roomData.wasted_seats.total_seat_periods_wasted],
    ['Average Wasted Seats Per Period', roomData.wasted_seats.average_wasted_seats],
  ];

  for (const [k, v] of kpiRows) {
    const r = wsSum.addRow([k, v]);
    r.height = 20;
    formatDataCell(r.getCell(1), k, 'left', 'FFF8FAFC', true);
    formatDataCell(r.getCell(2), v, 'right', k === 'Total Clashes (Hard Constraints)' ? (v === 0 ? 'FFF0FDF4' : 'FFFFE4E6') : undefined, true);
    sumRowIdx++;
  }

  sumRowIdx++; // spacer

  // Clash Breakdown Table
  wsSum.mergeCells(`A${sumRowIdx}:B${sumRowIdx}`);
  formatHeaderCell(wsSum.getCell(`A${sumRowIdx}`), 'Independent Clash Verification Breakdown');
  sumRowIdx++;

  const clashItems = [
    ['Staff Double-Booked', clashes.timetable_clashes.staff_clashes],
    ['Room Double-Booked', clashes.timetable_clashes.room_clashes],
    ['Section Double-Booked', clashes.timetable_clashes.section_clashes],
    ['Student Choice Clashes', clashes.timetable_clashes.student_clashes],
    ['Room Capacity Violations', clashes.timetable_clashes.capacity_violations],
    ['Room Type Mismatches', clashes.timetable_clashes.room_type_violations],
    ['Hour Mismatches', clashes.timetable_clashes.hour_mismatches],
    ['Broken Lab Blocks', clashes.timetable_clashes.lab_block_violations],
    ['Calendar Date Conflicts', clashes.calendar_clashes.staff_clashes + clashes.calendar_clashes.room_clashes],
  ];

  for (const [k, v] of clashItems) {
    const r = wsSum.addRow([k, v]);
    r.height = 20;
    formatDataCell(r.getCell(1), k, 'left', undefined, false);
    formatDataCell(r.getCell(2), v, 'center', v === 0 ? 'FFF0FDF4' : 'FFFFE4E6', Number(v) > 0);
    sumRowIdx++;
  }

  wsSum.getColumn(1).width = 34;
  wsSum.getColumn(2).width = 30;

  // Write file to disk
  await workbook.xlsx.writeFile(filePath);
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

  return {
    filename,
    filePath,
    buffer,
    fileSize: buffer.length,
  };
}
