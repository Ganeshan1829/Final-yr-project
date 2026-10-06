import { registerRule } from '../registry.js';
export function registerRoomsRules() {
    // ROM-001: Trim
    registerRule({
        code: 'ROM-001',
        dataset: 'rooms',
        severity: 'warning',
        description: 'Trim leading/trailing spaces in rooms cells',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                for (const [col, val] of Object.entries(row.data)) {
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        if (trimmed !== val) {
                            row.data[col] = trimmed;
                            ctx.addIssue({
                                rule_code: 'ROM-001',
                                dataset: 'rooms',
                                row_number: row.row_number,
                                column: col,
                                severity: 'warning',
                                action_taken: 'fixed',
                                original_value: val,
                                new_value: trimmed,
                                message: `Trimmed whitespace from ${col}`,
                            });
                        }
                    }
                }
            }
        },
    });
    // ROM-002: Case normalization
    registerRule({
        code: 'ROM-002',
        dataset: 'rooms',
        severity: 'warning',
        description: 'Normalize case: room_id UPPER, room_type, status lower (booleans parsed case-insensitively)',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                // room_id upper
                const roomId = row.data.room_id;
                if (typeof roomId === 'string' && roomId.length > 0) {
                    const upper = roomId.toUpperCase();
                    if (upper !== roomId) {
                        row.data.room_id = upper;
                        ctx.addIssue({
                            rule_code: 'ROM-002',
                            dataset: 'rooms',
                            row_number: row.row_number,
                            column: 'room_id',
                            severity: 'warning',
                            action_taken: 'fixed',
                            original_value: roomId,
                            new_value: upper,
                            message: `Normalized room_id to uppercase`,
                        });
                    }
                }
                // room_type lower
                const roomType = row.data.room_type;
                if (typeof roomType === 'string' && roomType.length > 0) {
                    const lower = roomType.toLowerCase();
                    if (lower !== roomType) {
                        row.data.room_type = lower;
                        ctx.addIssue({
                            rule_code: 'ROM-002',
                            dataset: 'rooms',
                            row_number: row.row_number,
                            column: 'room_type',
                            severity: 'warning',
                            action_taken: 'fixed',
                            original_value: roomType,
                            new_value: lower,
                            message: `Normalized room_type to lowercase`,
                        });
                    }
                }
                // status lower
                const status = row.data.status;
                if (typeof status === 'string' && status.length > 0) {
                    const lower = status.toLowerCase();
                    if (lower !== status) {
                        row.data.status = lower;
                        ctx.addIssue({
                            rule_code: 'ROM-002',
                            dataset: 'rooms',
                            row_number: row.row_number,
                            column: 'status',
                            severity: 'warning',
                            action_taken: 'fixed',
                            original_value: status,
                            new_value: lower,
                            message: `Normalized status to lowercase`,
                        });
                    }
                }
                // Boolean columns: parsed case-insensitively with NO issue
                for (const boolCol of ['has_projector', 'is_ac']) {
                    const val = row.data[boolCol];
                    if (typeof val === 'string' && val.trim().length > 0) {
                        const b = val.trim().toLowerCase();
                        row.data[boolCol] = b === 'true' || b === '1' || b === 'yes';
                    }
                    else if (typeof val === 'boolean') {
                        row.data[boolCol] = val;
                    }
                }
            }
        },
    });
    // ROM-003: Exact duplicate row removed
    registerRule({
        code: 'ROM-003',
        dataset: 'rooms',
        severity: 'warning',
        description: 'Exact duplicate row removed, keeping the first',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            const seen = new Set();
            const surviving = [];
            for (const row of rows) {
                const key = JSON.stringify(row.data);
                if (seen.has(key)) {
                    ctx.addIssue({
                        rule_code: 'ROM-003',
                        dataset: 'rooms',
                        row_number: row.row_number,
                        column: null,
                        severity: 'warning',
                        action_taken: 'removed',
                        original_value: key,
                        new_value: null,
                        message: `Exact duplicate row removed (row ${row.row_number})`,
                    });
                }
                else {
                    seen.add(key);
                    surviving.push(row);
                }
            }
            ctx.datasets.rooms = surviving;
        },
    });
    // ROM-004: Same room_id with different values
    registerRule({
        code: 'ROM-004',
        dataset: 'rooms',
        severity: 'error',
        description: 'Same room_id with different values',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            const byId = new Map();
            for (const row of rows) {
                const id = row.data.room_id;
                if (!id)
                    continue;
                if (!byId.has(id)) {
                    byId.set(id, []);
                }
                byId.get(id).push(row);
            }
            for (const [id, group] of byId.entries()) {
                if (group.length > 1) {
                    for (let i = 1; i < group.length; i++) {
                        ctx.addIssue({
                            rule_code: 'ROM-004',
                            dataset: 'rooms',
                            row_number: group[i].row_number,
                            column: 'room_id',
                            severity: 'error',
                            action_taken: null,
                            original_value: id,
                            new_value: null,
                            message: `Conflicting room definition for ${id} with differing attributes`,
                        });
                    }
                }
            }
        },
    });
    // ROM-005: Blank has_projector or is_ac filled with false
    registerRule({
        code: 'ROM-005',
        dataset: 'rooms',
        severity: 'warning',
        description: 'Blank has_projector or is_ac filled with false',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                for (const col of ['has_projector', 'is_ac']) {
                    const val = row.data[col];
                    if (val === undefined || val === null || val === '') {
                        row.data[col] = false;
                        ctx.addIssue({
                            rule_code: 'ROM-005',
                            dataset: 'rooms',
                            row_number: row.row_number,
                            column: col,
                            severity: 'warning',
                            action_taken: 'filled',
                            original_value: String(val ?? ''),
                            new_value: 'false',
                            message: `Filled blank ${col} with false`,
                        });
                    }
                }
            }
        },
    });
    // ROM-006: Blank status filled with active
    registerRule({
        code: 'ROM-006',
        dataset: 'rooms',
        severity: 'warning',
        description: 'Blank status filled with active',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                const val = row.data.status;
                if (val === undefined || val === null || String(val).trim() === '') {
                    row.data.status = 'active';
                    ctx.addIssue({
                        rule_code: 'ROM-006',
                        dataset: 'rooms',
                        row_number: row.row_number,
                        column: 'status',
                        severity: 'warning',
                        action_taken: 'filled',
                        original_value: String(val ?? ''),
                        new_value: 'active',
                        message: `Filled blank status with active`,
                    });
                }
            }
        },
    });
    // ROM-007: Capacity not a positive whole number
    registerRule({
        code: 'ROM-007',
        dataset: 'rooms',
        severity: 'error',
        description: 'capacity not a positive whole number',
        run: (ctx) => {
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                const val = row.data.capacity;
                const num = Number(val);
                if (!Number.isInteger(num) || num <= 0) {
                    ctx.addIssue({
                        rule_code: 'ROM-007',
                        dataset: 'rooms',
                        row_number: row.row_number,
                        column: 'capacity',
                        severity: 'error',
                        action_taken: null,
                        original_value: String(val ?? ''),
                        new_value: null,
                        message: `capacity must be a positive whole number, received: ${val}`,
                    });
                }
            }
        },
    });
    // ROM-008: room_type or status outside the allowed list, blank included
    registerRule({
        code: 'ROM-008',
        dataset: 'rooms',
        severity: 'error',
        description: 'room_type or status outside the allowed list, blank included',
        run: (ctx) => {
            const allowedTypes = ['classroom', 'computer_lab', 'seminar_hall', 'auditorium'];
            const allowedStatus = ['active', 'maintenance'];
            const rows = ctx.datasets.rooms;
            for (const row of rows) {
                const type = String(row.data.room_type || '').toLowerCase();
                if (!allowedTypes.includes(type)) {
                    ctx.addIssue({
                        rule_code: 'ROM-008',
                        dataset: 'rooms',
                        row_number: row.row_number,
                        column: 'room_type',
                        severity: 'error',
                        action_taken: null,
                        original_value: String(row.data.room_type ?? ''),
                        new_value: null,
                        message: `Invalid room_type '${row.data.room_type}', allowed: ${allowedTypes.join(', ')}`,
                    });
                }
                const status = String(row.data.status || '').toLowerCase();
                if (!allowedStatus.includes(status)) {
                    ctx.addIssue({
                        rule_code: 'ROM-008',
                        dataset: 'rooms',
                        row_number: row.row_number,
                        column: 'status',
                        severity: 'error',
                        action_taken: null,
                        original_value: String(row.data.status ?? ''),
                        new_value: null,
                        message: `Invalid room status '${row.data.status}', allowed: ${allowedStatus.join(', ')}`,
                    });
                }
            }
        },
    });
}
