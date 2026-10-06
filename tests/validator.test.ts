import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFileContent, validateDatasetContent } from '../server/src/services/validator.js';

describe('Validator Unit Tests', () => {
  it('should successfully validate well-formed CSV data with status "Uploaded"', () => {
    const csv = `subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,lab_block_periods,required_room_type,department,semester
CS101,Programming Fundamentals,theory,4,4,60,0,classroom,CSE,1
CS102,Hardware Lab,lab,2,3,45,3,computer_lab,CSE,1`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'subjects.csv');
    const { report } = validateDatasetContent('subjects', 'subjects.csv', csv.length, rawHeaders, rawRows);

    expect(report.status).toBe('Uploaded');
    expect(report.isValid).toBe(true);
    expect(report.rowCount).toBe(2);
    expect(report.missingColumns).toHaveLength(0);
    expect(report.errors).toHaveLength(0);
  });

  it('should detect missing columns and set status to "Has issues"', () => {
    // Missing required_room_type and lab_block_periods
    const csv = `subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,department,semester
CS101,Programming Fundamentals,theory,4,4,60,CSE,1`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'subjects.csv');
    const { report } = validateDatasetContent('subjects', 'subjects.csv', csv.length, rawHeaders, rawRows);

    expect(report.status).toBe('Has issues');
    expect(report.isValid).toBe(false);
    expect(report.missingColumns).toContain('lab_block_periods');
    expect(report.missingColumns).toContain('required_room_type');
    expect(report.errors.some((e) => e.includes('Missing required column(s)'))).toBe(true);
  });

  it('should identify unexpected extra columns without failing required validation', () => {
    const csv = `subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,lab_block_periods,required_room_type,department,semester,extra_field_1
CS101,Programming Fundamentals,theory,4,4,60,0,classroom,CSE,1,random_value`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'subjects.csv');
    const { report } = validateDatasetContent('subjects', 'subjects.csv', csv.length, rawHeaders, rawRows);

    expect(report.status).toBe('Uploaded');
    expect(report.unexpectedColumns).toContain('extra_field_1');
    expect(report.warnings.some((w) => w.includes('unexpected column(s)'))).toBe(true);
  });

  it('should report error for empty file with 0 rows', () => {
    const csv = `subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,lab_block_periods,required_room_type,department,semester\n`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'subjects.csv');
    const { report } = validateDatasetContent('subjects', 'subjects.csv', csv.length, rawHeaders, rawRows);

    expect(report.status).toBe('Has issues');
    expect(report.rowCount).toBe(0);
    expect(report.errors).toContain('File contains no data rows.');
  });

  it('should detect values outside allowed enum lists as warnings', () => {
    const csv = `room_id,room_name,building,floor,capacity,room_type,has_projector,is_ac,status
R101,Lab 1,Block A,1,60,virtual_reality_room,true,true,pending_inspection`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'rooms.csv');
    const { report } = validateDatasetContent('rooms', 'rooms.csv', csv.length, rawHeaders, rawRows);

    // Status is still Uploaded because all columns are present; value issues are warnings
    expect(report.status).toBe('Uploaded');
    const roomTypeSummary = report.columnSummaries['room_type'];
    expect(roomTypeSummary.invalidEnumCount).toBe(1);
    expect(roomTypeSummary.invalidEnumExamples).toContain('virtual_reality_room');

    const statusSummary = report.columnSummaries['status'];
    expect(statusSummary.invalidEnumCount).toBe(1);
    expect(statusSummary.invalidEnumExamples).toContain('pending_inspection');
  });

  it('should be robust to header case and leading/trailing spacing', () => {
    const csv = ` SUBJECT_CODE , Subject_Name , SUBJECT_TYPE , Credits , Hours_Per_Week , Total_Hours , Lab_Block_Periods , Required_Room_Type , Department , Semester 
CS201,Advanced Algorithms,theory,4,4,60,0,classroom,CSE,3`;

    const { rawHeaders, rawRows } = parseFileContent(Buffer.from(csv), 'subjects.csv');
    const { report } = validateDatasetContent('subjects', 'subjects.csv', csv.length, rawHeaders, rawRows);

    expect(report.status).toBe('Uploaded');
    expect(report.missingColumns).toHaveLength(0);
    expect(report.rowCount).toBe(1);
  });

  it('should have CSV and XLSX parity: parsing identical data produces equivalent reports', () => {
    const data = [
      {
        subject_code: 'CS101',
        subject_name: 'Intro to CS',
        subject_type: 'theory',
        credits: 3,
        hours_per_week: 3,
        total_hours: 45,
        lab_block_periods: 0,
        required_room_type: 'classroom',
        department: 'CSE',
        semester: 1,
      },
    ];

    // CSV representation
    const csvContent =
      'subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,lab_block_periods,required_room_type,department,semester\n' +
      'CS101,Intro to CS,theory,3,3,45,0,classroom,CSE,1';
    const csvParsed = parseFileContent(Buffer.from(csvContent), 'subjects.csv');
    const csvValidation = validateDatasetContent(
      'subjects',
      'subjects.csv',
      csvContent.length,
      csvParsed.rawHeaders,
      csvParsed.rawRows
    );

    // XLSX representation
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const xlsxParsed = parseFileContent(xlsxBuf, 'subjects.xlsx');
    const xlsxValidation = validateDatasetContent(
      'subjects',
      'subjects.xlsx',
      xlsxBuf.length,
      xlsxParsed.rawHeaders,
      xlsxParsed.rawRows
    );

    expect(csvValidation.report.status).toBe(xlsxValidation.report.status);
    expect(csvValidation.report.rowCount).toBe(xlsxValidation.report.rowCount);
    expect(csvValidation.report.missingColumns).toEqual(xlsxValidation.report.missingColumns);
  });
});
