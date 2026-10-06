import { getAllDatasetsStatus } from './uploadService.js';
import { getStoredRules } from './rulesService.js';
import { listHolidays } from './holidaysService.js';
export function getReadiness() {
    const datasetStatuses = getAllDatasetsStatus();
    const { rules, updatedAt: rulesUpdatedAt } = getStoredRules();
    const holidays = listHolidays();
    const items = [];
    // Required datasets: students_choices, subjects, rooms, staff
    const requiredDatasets = ['students_choices', 'subjects', 'rooms', 'staff'];
    let requiredCompleted = 0;
    for (const dsId of requiredDatasets) {
        const ds = datasetStatuses.find((d) => d.id === dsId);
        const isCompleted = ds?.status === 'Uploaded';
        if (isCompleted)
            requiredCompleted++;
        items.push({
            id: dsId,
            name: ds?.name || dsId,
            isRequired: true,
            isCompleted: !!isCompleted,
            status: ds?.status || 'Not uploaded',
            fileName: ds?.fileName || null,
            rowCount: ds?.rowCount || 0,
            updatedAt: ds?.uploadedAt || null,
            missingColumns: ds?.report?.missingColumns || [],
            issuesCount: (ds?.report?.errors.length || 0) + (ds?.report?.warnings.length || 0),
        });
    }
    // Rules item (required)
    const rulesConfigured = !!rules;
    if (rulesConfigured)
        requiredCompleted++;
    items.push({
        id: 'rules',
        name: 'Academic Scheduling Rules',
        isRequired: true,
        isCompleted: rulesConfigured,
        status: rulesConfigured ? 'Configured' : 'Not configured',
        fileName: rulesConfigured ? 'rules.json' : null,
        rowCount: rulesConfigured ? (rules?.periods?.length || 0) : 0,
        updatedAt: rulesUpdatedAt,
        missingColumns: [],
        issuesCount: 0,
    });
    // Optional: holidays
    const holidaysDs = datasetStatuses.find((d) => d.id === 'holidays');
    const holidayRowCount = holidays.length > 0 ? holidays.length : holidaysDs?.rowCount || 0;
    const holidaysCompleted = holidays.length > 0 || holidaysDs?.status === 'Uploaded';
    items.push({
        id: 'holidays',
        name: 'Holidays & Academic Breaks',
        isRequired: false,
        isCompleted: holidaysCompleted,
        status: holidaysCompleted ? (holidaysDs?.status === 'Has issues' ? 'Has issues' : 'Uploaded') : 'Not uploaded',
        fileName: holidaysDs?.fileName || (holidays.length > 0 ? 'Holidays table' : null),
        rowCount: holidayRowCount,
        updatedAt: holidaysDs?.uploadedAt || (holidays.length > 0 ? holidays[0].created_at : null),
        missingColumns: holidaysDs?.report?.missingColumns || [],
        issuesCount: holidaysDs?.report?.errors.length || 0,
    });
    const totalRequired = 5;
    const isReady = requiredCompleted === totalRequired;
    const percentage = Math.round((requiredCompleted / totalRequired) * 100);
    return {
        completedRequiredCount: requiredCompleted,
        totalRequiredCount: totalRequired,
        percentage,
        isReadyForValidation: isReady,
        items,
    };
}
