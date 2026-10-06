import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../../../sample-data');
if (!fs.existsSync(sampleDataDir)) {
    fs.mkdirSync(sampleDataDir, { recursive: true });
}
// 1. subjects.csv (8 rows)
const subjectsHeader = 'subject_code,subject_name,subject_type,credits,hours_per_week,total_hours,lab_block_periods,required_room_type,department,semester\n';
const subjectsRows = [
    'CS301,Data Structures and Algorithms,theory,4,4,60,0,classroom,Computer Science & Engineering,5',
    'CS302,Database Management Systems,theory,3,3,45,0,classroom,Computer Science & Engineering,5',
    'CS303,Operating Systems,theory,3,3,45,0,classroom,Computer Science & Engineering,5',
    'CS304,Computer Networks,theory,3,3,45,0,classroom,Computer Science & Engineering,5',
    'CS305,Artificial Intelligence,theory,3,3,45,0,classroom,Computer Science & Engineering,5',
    'CS306,Web Development Technologies,theory,3,3,45,0,classroom,Computer Science & Engineering,5',
    'CS311,Data Structures Laboratory,lab,2,3,45,3,computer_lab,Computer Science & Engineering,5',
    'CS312,Database Systems Laboratory,lab,2,3,45,3,computer_lab,Computer Science & Engineering,5',
].join('\n');
fs.writeFileSync(path.join(sampleDataDir, 'subjects.csv'), subjectsHeader + subjectsRows + '\n');
// 2. rooms.csv (17 rows)
const roomsHeader = 'room_id,room_name,building,floor,capacity,room_type,has_projector,is_ac,status\n';
const roomsRows = [
    'LH-101,Lecture Hall 101,Turing Block,1,70,classroom,true,true,active',
    'LH-102,Lecture Hall 102,Turing Block,1,70,classroom,true,true,active',
    'LH-103,Lecture Hall 103,Turing Block,1,65,classroom,true,false,active',
    'LH-201,Lecture Hall 201,Turing Block,2,70,classroom,true,true,active',
    'LH-202,Lecture Hall 202,Turing Block,2,65,classroom,true,true,active',
    'LH-203,Lecture Hall 203,Turing Block,2,60,classroom,false,false,active',
    'LH-301,Lecture Hall 301,Babbage Block,3,65,classroom,true,true,active',
    'LH-302,Lecture Hall 302,Babbage Block,3,65,classroom,true,false,active',
    'LH-303,Lecture Hall 303,Babbage Block,3,55,classroom,false,false,active',
    'LAB-1,Computing Lab 1 (AI & ML),Ada Block,1,45,computer_lab,true,true,active',
    'LAB-2,Computing Lab 2 (Systems),Ada Block,1,45,computer_lab,true,true,active',
    'LAB-3,Computing Lab 3 (Web Tech),Ada Block,2,40,computer_lab,true,true,active',
    'LAB-4,Computing Lab 4 (Networks),Ada Block,2,40,computer_lab,true,false,active',
    'SEM-1,Seminar Hall Alpha,Main Block,1,120,seminar_hall,true,true,active',
    'SEM-2,Seminar Hall Beta,Main Block,2,100,seminar_hall,true,true,active',
    'AUD-1,Main University Auditorium,Central Complex,1,400,auditorium,true,true,active',
    'LH-104,Lecture Hall 104,Turing Block,1,60,classroom,false,false,maintenance',
].join('\n');
fs.writeFileSync(path.join(sampleDataDir, 'rooms.csv'), roomsHeader + roomsRows + '\n');
// 3. staff.csv (14 rows)
const staffHeader = 'staff_id,staff_name,designation,department,email,subjects_can_teach,max_hours_per_week,hours_committed_elsewhere\n';
const staffRows = [
    'STF001,Dr. Rajesh Sharma,Professor & HOD,Computer Science & Engineering,rajesh.sharma@univ.edu,CS301;CS305,16,2',
    'STF002,Dr. Priya Sundaram,Associate Professor,Computer Science & Engineering,priya.s@univ.edu,CS302;CS312,18,0',
    'STF003,Prof. Amitav Roy,Assistant Professor,Computer Science & Engineering,amitav.roy@univ.edu,CS303;CS304,20,4',
    'STF004,Dr. Kavitha Raman,Associate Professor,Computer Science & Engineering,kavitha.r@univ.edu,CS301;CS311,18,0',
    'STF005,Prof. Suresh Kumar,Assistant Professor,Computer Science & Engineering,suresh.k@univ.edu,CS304;CS303,20,2',
    'STF006,Dr. Sunita Patel,Associate Professor,Computer Science & Engineering,sunita.patel@univ.edu,CS302;CS305,18,0',
    'STF007,Prof. Vikram Menon,Assistant Professor,Computer Science & Engineering,vikram.m@univ.edu,CS306;CS311,20,0',
    'STF008,Prof. Deepa Nair,Assistant Professor,Computer Science & Engineering,deepa.nair@univ.edu,CS305;CS301,20,2',
    'STF009,Dr. Manoj Joshi,Professor,Computer Science & Engineering,manoj.joshi@univ.edu,CS303;CS304,16,4',
    'STF010,Prof. Anita Desai,Assistant Professor,Computer Science & Engineering,anita.desai@univ.edu,CS306;CS312,20,0',
    'STF011,Prof. Karthik Venkatesh,Assistant Professor,Computer Science & Engineering,karthik.v@univ.edu,CS302;CS306,20,0',
    'STF012,Dr. Meenakshi Iyer,Associate Professor,Computer Science & Engineering,meenakshi.i@univ.edu,CS301;CS305,18,2',
    'STF013,Prof. Rohan Verma,Assistant Professor,Computer Science & Engineering,rohan.v@univ.edu,CS304;CS311,20,0',
    'STF014,Prof. Swati Mukherjee,Assistant Professor,Computer Science & Engineering,swati.m@univ.edu,CS303;CS312,20,0',
].join('\n');
fs.writeFileSync(path.join(sampleDataDir, 'staff.csv'), staffHeader + staffRows + '\n');
// 4. holidays.csv (11 rows)
const holidaysHeader = 'holiday_id,name,date_from,date_to,type,applies_to\n';
const holidaysRows = [
    'HOL-01,Muharram,2026-07-17,2026-07-17,public_holiday,ALL',
    'HOL-02,Independence Day,2026-08-15,2026-08-15,public_holiday,ALL',
    'HOL-03,Milad un-Nabi,2026-08-26,2026-08-26,public_holiday,ALL',
    'HOL-04,Mid-Semester Examination Blackout,2026-09-07,2026-09-12,internal_exam,ALL',
    'HOL-05,Mahatma Gandhi Birthday,2026-10-02,2026-10-02,public_holiday,ALL',
    'HOL-06,Dussehra Holidays,2026-10-19,2026-10-21,institution_holiday,ALL',
    'HOL-07,Diwali Festival Break,2026-11-08,2026-11-10,public_holiday,ALL',
    'HOL-08,Guru Nanak Jayanti,2026-11-24,2026-11-24,public_holiday,ALL',
    'HOL-09,Faculty Development Day,2026-07-31,2026-07-31,institution_holiday,FACULTY_ONLY',
    'HOL-10,Sports & Cultural Fest Day,2026-09-25,2026-09-25,institution_holiday,ALL',
    'HOL-11,University Annual Day,2026-10-30,2026-10-30,institution_holiday,ALL',
].join('\n');
fs.writeFileSync(path.join(sampleDataDir, 'holidays.csv'), holidaysHeader + holidaysRows + '\n');
// 5. students_choices.csv (960 rows: 160 students x 6 subject choices each)
const studentsChoicesHeader = 'selection_id,selected_at,student_id,roll_no,student_name,department,year,semester,subject_code,staff_id,selection_order\n';
const studentFirstNames = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Diya', 'Ananya', 'Aadhya', 'Pari', 'Saanvi', 'Myra', 'Ira', 'Avani', 'Riya', 'Kavya', 'Meera', 'Sneha'];
const studentLastNames = ['Sharma', 'Verma', 'Patel', 'Sundaram', 'Nair', 'Menon', 'Rao', 'Reddy', 'Gupta', 'Kumar', 'Singh', 'Chopra', 'Joshi', 'Mukherjee', 'Das', 'Bose'];
const subjectList = ['CS301', 'CS302', 'CS303', 'CS304', 'CS305', 'CS306'];
const staffMap = {
    CS301: ['STF001', 'STF004', 'STF008', 'STF012'],
    CS302: ['STF002', 'STF006', 'STF011'],
    CS303: ['STF003', 'STF005', 'STF009', 'STF014'],
    CS304: ['STF003', 'STF005', 'STF009', 'STF013'],
    CS305: ['STF001', 'STF006', 'STF008', 'STF012'],
    CS306: ['STF007', 'STF010', 'STF011'],
};
const choiceRows = [];
let selCounter = 1;
for (let s = 1; s <= 160; s++) {
    const studentId = `STU${String(s).padStart(4, '0')}`;
    const rollNo = `23CS${String(s).padStart(3, '0')}`;
    const fn = studentFirstNames[(s - 1) % studentFirstNames.length];
    const ln = studentLastNames[(s - 1) % studentLastNames.length];
    const studentName = `${fn} ${ln}`;
    subjectList.forEach((subCode, idx) => {
        const selId = `SEL${String(selCounter++).padStart(5, '0')}`;
        const potentialStaff = staffMap[subCode] || ['STF001'];
        const staffId = potentialStaff[s % potentialStaff.length];
        const order = idx + 1;
        choiceRows.push(`${selId},2026-06-15 10:00:00,${studentId},${rollNo},${studentName},Computer Science & Engineering,3,5,${subCode},${staffId},${order}`);
    });
}
fs.writeFileSync(path.join(sampleDataDir, 'students_choices.csv'), studentsChoicesHeader + choiceRows.join('\n') + '\n');
// 6. rules.csv
const rulesCsvContent = `key,value,description
semester_name,Fall 2026,Academic semester label
academic_year,2026-2027,Academic year
department,Computer Science & Engineering,Department name
semester_start,2026-07-06,Semester starting date (YYYY-MM-DD)
semester_end,2026-11-27,Semester ending date (YYYY-MM-DD)
working_days,MON;TUE;WED;THU;FRI,Semicolon-separated list of working days
saturday_makeup_allowed,false,Whether make-up classes can be scheduled on Saturdays
periods_per_day,7,Total instructional periods per day
period_1,08:30-09:20,Timing for period slot 1
period_2,09:25-10:15,Timing for period slot 2
period_3,10:30-11:20,Timing for period slot 3
period_4,11:25-12:15,Timing for period slot 4
period_5,13:15-14:05,Timing for period slot 5
period_6,14:10-15:00,Timing for period slot 6
period_7,15:05-15:55,Timing for period slot 7
teaching_weeks_planned,16,Number of active teaching weeks planned
default_section_size,60,Standard student cohort size per section
min_section_size,30,Minimum allowed cohort size per section
max_section_size,70,Maximum cap on students per section
max_consecutive_theory_periods,2,Max back-to-back theory periods allowed
max_staff_periods_per_day,4,Maximum teaching load per faculty member per day
timezone,Asia/Kolkata,Institution local timezone
`;
fs.writeFileSync(path.join(sampleDataDir, 'rules.csv'), rulesCsvContent);
// 7. events.csv
const eventsContent = `event_id,event_name,event_type,date,start_period,end_period,venue_room_id,staff_involved,student_scope,expected_attendance
EVT-01,AI Technical Symposium Inauguration,Symposium,2026-08-21,1,3,AUD-1,STF001;STF008,ALL,350
EVT-02,Guest Lecture on Cloud Architectures,Guest Lecture,2026-09-18,5,6,SEM-1,STF003;STF005,PARTIAL,110
EVT-03,Coding Marathon Hackathon,Hackathon,2026-10-16,3,7,LAB-1,STF004;STF007,PARTIAL,40
EVT-04,Industry Advisory Board Meeting,Meeting,2026-11-13,6,7,SEM-2,STF001;STF002;STF009,NONE,25
`;
fs.writeFileSync(path.join(sampleDataDir, 'events.csv'), eventsContent);
// 8. leave.csv
const leaveContent = `leave_id,staff_id,date_from,date_to,leave_type,reason,status
LEV-01,STF002,2026-08-10,2026-08-11,casual,Personal medical appointment,approved
LEV-02,STF003,2026-09-14,2026-09-16,conference,Presenting research paper at IEEE ICDE Conference,approved
LEV-03,STF005,2026-10-05,2026-10-06,on_duty,University zonal inspection committee duty,approved
LEV-04,STF008,2026-11-02,2026-11-04,earned,Family event,approved
`;
fs.writeFileSync(path.join(sampleDataDir, 'leave.csv'), leaveContent);
console.log('Sample data generated successfully:');
console.log(`- students_choices.csv: ${choiceRows.length} rows`);
console.log(`- subjects.csv: 8 rows`);
console.log(`- rooms.csv: 17 rows`);
console.log(`- staff.csv: 14 rows`);
console.log(`- holidays.csv: 11 rows`);
console.log(`- rules.csv, events.csv, leave.csv generated`);
